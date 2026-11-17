#!/usr/bin/env python3
"""Pinned DSH native protocol fixture. Run in a disposable --network none container.

Only a loopback fake Messages API and a synthetic credential are used. This is
software/protocol acceptance, never evidence of a real DeepSeek account call.
"""
import http.server
import json
import os
import pathlib
import queue
import subprocess
import tempfile
import threading
import time


class Model(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.requests.append(body)
        tool_result = any(
            part.get("type") == "tool_result"
            for message in body.get("messages", [])
            if isinstance(message.get("content"), list)
            for part in message["content"] if isinstance(part, dict)
        )
        use_tool = bool(body.get("tools")) and not tool_result
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        frames = [("message_start", {"message": {
            "id": "fixture", "type": "message", "role": "assistant",
            "model": body["model"], "content": [], "stop_reason": None,
            "usage": {"input_tokens": 1, "output_tokens": 0},
        }})]
        if use_tool:
            assert any(tool["name"] == self.server.tool for tool in body["tools"])
            frames += [
                ("content_block_start", {"index": 0, "content_block": {
                    "type": "tool_use", "id": "fixture_tool", "name": self.server.tool, "input": {},
                }}),
                ("content_block_delta", {"index": 0, "delta": {
                    "type": "input_json_delta", "partial_json": json.dumps(self.server.arguments),
                }}),
            ]
        else:
            frames += [
                ("content_block_start", {"index": 0, "content_block": {"type": "text", "text": ""}}),
                ("content_block_delta", {"index": 0, "delta": {"type": "text_delta", "text": "fixture complete"}}),
            ]
        frames += [
            ("content_block_stop", {"index": 0}),
            ("message_delta", {"delta": {"stop_reason": "tool_use" if use_tool else "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 10}}),
            ("message_stop", {}),
        ]
        for name, data in frames:
            self.wfile.write(("event: " + name + "\ndata: " + json.dumps({"type": name, **data}) + "\n\n").encode())
            self.wfile.flush()


def run_case(mode, variant):
    with tempfile.TemporaryDirectory(prefix="maishu-dsh-work-") as directory:
        root = pathlib.Path(directory)
        workspace = root / "workspace"
        workspace.mkdir()
        marker = workspace / "marker.txt"
        (workspace / "input.txt").write_text("offline input")
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Model)
        server.requests = []
        server.tool = variant if variant in ("read", "write", "glob", "grep") else "bash"
        if variant == "read":
            server.arguments = {"file_path": str(workspace / "input.txt")}
        elif variant == "glob":
            server.arguments = {"pattern": "*.txt", "path": str(workspace)}
        elif variant == "grep":
            server.arguments = {"pattern": "offline", "path": str(workspace)}
        elif variant == "write":
            server.arguments = {"file_path": str(marker), "content": "fixture-complete"}
        else:
            server.arguments = {"description": "Write offline fixture completion marker", "command": "sleep .4; printf fixture-complete > marker.txt; printf fixture-complete",
                                "timeoutMs": 1 if variant == "promoted" else 10000}
            if variant == "background":
                server.arguments["run_in_background"] = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        environment = {
            "PATH": "/opt/maishu-tools/node_modules/.bin:/usr/local/bin:/usr/bin:/bin",
            "DSH_PATH": "/opt/maishu-dsh", "DSH_ACP_HOST": "/opt/maishu-dsh",
            "DSH_HOME": str(root / "home"), "DSH_SESSION_ROOT": str(root / "sessions"),
            "DEEPSEEK_API_KEY": "synthetic-offline-fixture-no-real-account",
            "DEEPSEEK_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1",
            "DSH_MODEL": "deepseek-flash", "LANG": "C.UTF-8",
        }
        process = subprocess.Popen(["/opt/maishu-tools/node_modules/.bin/dsh-acp", "--no-thinking"],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, env=environment, cwd=workspace, bufsize=1)
        incoming, events, errors = queue.Queue(), [], []

        def read():
            for line in process.stdout:
                incoming.put(json.loads(line))

        def stderr():
            errors.extend(process.stderr.readlines())

        threading.Thread(target=read, daemon=True).start()
        threading.Thread(target=stderr, daemon=True).start()

        def rpc(identifier, method, params):
            process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params}) + "\n")
            process.stdin.flush()
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                try:
                    message = incoming.get(timeout=1)
                except queue.Empty:
                    if process.poll() is not None:
                        raise AssertionError("adapter exited: " + "".join(errors)[-1000:])
                    continue
                if "method" in message and "id" in message:
                    raise AssertionError("unexpected host callback: " + message["method"])
                if message.get("id") == identifier:
                    assert "error" not in message, message
                    return message["result"]
                events.append(message)
            raise AssertionError("RPC timed out: " + method)

        try:
            initialized = rpc(1, "initialize", {"protocolVersion": 1, "clientCapabilities": {"_meta": {"terminal_output": True}}, "clientInfo": {"name": "maishu-offline-fixture", "version": "1"}})
            assert initialized["agentInfo"]["name"] == "dsh-acp"
            assert initialized["agentInfo"]["version"] == "0.4.41"
            session = rpc(2, "session/new", {"cwd": str(workspace), "mcpServers": []})
            sid = session["sessionId"]
            readback = rpc(3, "session/set_config_option", {"sessionId": sid, "configId": "mode", "value": mode})
            option = next(item for item in readback["configOptions"] if item["id"] == "mode")
            assert option["currentValue"] == mode
            assert {item["value"] for item in option["options"]} == {"read-only", "workspace-write", "danger-full-access"}
            response = rpc(4, "session/prompt", {"sessionId": sid, "prompt": [{"type": "text", "text": "Execute the offline fixture tool."}]})
            assert response["stopReason"] == "end_turn"
            updates = [event.get("params", {}).get("update", {}) for event in events]
            terminal = [update for update in updates if update.get("toolCallId") == "fixture_tool" and update.get("status") in ("completed", "failed")]
            assert len(terminal) == 1, terminal
            update = terminal[0]
            value = update.get("_meta", {}).get("dsh", {}).get("toolResult", {}).get("value")
            marker_before = marker.exists()
            if variant in ("promoted", "background"):
                assert value["kind"] in ("promoted", "background"), value
                assert value["jobId"] and not marker_before
                # Crucial negative: terminal_exit=0 does NOT prove process exit.
                assert update["_meta"]["terminal_exit"]["exit_code"] == 0
            elif variant in ("read", "write", "glob", "grep"):
                assert update["status"] == "completed", update
                if variant == "write":
                    assert marker.read_text() == "fixture-complete"
            else:
                assert value["kind"] == "foreground" and value["exitCode"] == 0
                if mode == "read-only":
                    assert not marker_before and "Permission denied" in value["stderr"]["text"]
                else:
                    assert marker.read_text() == "fixture-complete"
            time.sleep(1.2)
            late = []
            while not incoming.empty():
                late.append(incoming.get_nowait())
            late_tools = [event for event in late if event.get("params", {}).get("update", {}).get("sessionUpdate") in ("tool_call", "tool_call_update")]
            if variant not in ("promoted", "background"):
                assert not late_tools, late_tools
            print(json.dumps({"mode": mode, "variant": variant, "toolKind": update.get("kind") or next(item.get("kind") for item in updates if item.get("toolCallId") == "fixture_tool"), "status": update["status"], "value": value, "markerBeforePromptReturn": marker_before, "lateToolNotifications": len(late_tools), "requests": len(server.requests)}), flush=True)
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            server.shutdown()


if __name__ == "__main__":
    assert pathlib.Path("/opt/maishu-dsh").exists(), "requires the dedicated pinned runtime image"
    for permission, fixture in [("read-only", "foreground"), ("workspace-write", "foreground"),
                                ("danger-full-access", "foreground"), ("danger-full-access", "read"),
                                ("danger-full-access", "write"), ("danger-full-access", "glob"),
                                ("danger-full-access", "grep"), ("danger-full-access", "promoted"),
                                ("danger-full-access", "background")]:
        run_case(permission, fixture)
    print(json.dumps({"passed": 9, "scope": "offline synthetic model; no real account inference"}), flush=True)
