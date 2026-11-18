// 麦枢修改：中文品牌、控制台与执行配置扩展；保留上游兼容接口。
import { uiText } from "../i18n/ui-text";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getActiveTenantId } from "../lib/api";
import yaml from "js-yaml";
import { TrashIcon } from "lucide-react";
import type { BetaSkill } from "@anthropic-ai/sdk/resources/beta/skills/skills";
import type {
  BetaSkillVersion,
} from "@anthropic-ai/sdk/resources/beta/skills/versions";
import { useInfiniteApiQuery } from "../lib/useApiQuery";
import { useManagedApi } from "../lib/useManagedApi";
import {
  extractManagedSkillFiles,
  readSkillArchivePreview,
} from "../lib/skill-upload";
import { Modal } from "../components/Modal";
import { Button } from "@/components/ui/button";
import { PopoverContent } from "@/components/ui/popover";
import { DataTable, type ColumnDef } from "../components/DataTable";
import { FacetedFilter } from "../components/FacetedFilter";
import { FilterChip } from "../components/FilterChip";
import {
  InstallFromUrlModal,
  SkillUpdatesModal,
  sourceLabel,
  useSkillSources,
} from "../components/SkillSources";

/* ---------- types ---------- */

type Skill = BetaSkill & { name?: string; description?: string };

interface SkillFile {
  filename: string;
  content: string;
  encoding?: "utf8" | "base64";
}

type VersionSummary = BetaSkillVersion;

type VersionDetail = BetaSkillVersion & {
  files: SkillFile[];
};

type SourceValue = "any" | "anthropic" | "custom";

const SOURCE_OPTIONS: { value: SourceValue; label: string }[] = [
  { value: "any", label: uiText("All") },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: uiText("Custom") },
];

/* ---------- constants ---------- */

// Mirrors the default UPLOAD_MAX_BYTES on the server (apps/main/src/quotas.ts).
// Self-hosters who raised the server limit will lose this client-side
// pre-rejection but the server will still enforce; that's an acceptable
// degradation for an unusual config.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const SKILLS_API = "/v1/skills";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

function isDescription(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "" && !/^[|>][+\d-]*$/.test(value.trim());
}

function skillDescription(value: string | undefined, files: SkillFile[]): string | undefined {
  if (isDescription(value)) return value.trim();
  // Some uploaded versions saved the YAML block indicator instead of its text.
  const manifest = files.find((file) => /(?:^|\/)SKILL\.md$/i.test(file.filename));
  const frontMatter = manifest?.content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontMatter) return undefined;
  try {
    const metadata = yaml.load(frontMatter[1], { schema: yaml.JSON_SCHEMA }) as { description?: unknown } | null;
    return typeof metadata?.description === "string" && isDescription(metadata.description)
      ? metadata.description.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function SkillDescriptionCell({ skill }: { skill: Skill }) {
  const managedApi = useManagedApi();
  const version = skill.latest_version_id;
  const fromList = isDescription(skill.description) ? skill.description.trim() : undefined;
  const query = useQuery({
    queryKey: ["skill-description", getActiveTenantId(), skill.id, version],
    enabled: !fromList && Boolean(version),
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      if (!version) return null;
      const params = { skill_id: skill.id };
      const detail = await managedApi.skills.versions.retrieve(version, params);
      if (isDescription(detail.description)) return detail.description.trim();
      const response = await managedApi.skills.versions.download(version, params);
      return skillDescription(
        detail.description,
        readSkillArchivePreview(new Uint8Array(await response.arrayBuffer())),
      ) ?? null;
    },
  });
  const description = fromList ?? query.data;
  const text = description ?? (query.isFetching ? "加载中…" : query.isError ? "描述读取失败" : "暂无描述");
  return <span className="block truncate text-fg-muted" title={description ?? undefined}>{text}</span>;
}

/* ---------- component ---------- */

export function SkillsList() {
  const managedApi = useManagedApi();

  /* Server-driven filter state. `source` flows into skillsParams below
   * → useApiQuery reruns when params change → list reflects exactly
   * what the server returned (no client-side split on s.source). */
  const [source, setSource] = useState<SourceValue>("any");
  const skillsParams = useMemo(
    () => (source !== "any" ? { source } : {}),
    [source],
  );

  /* list state — TQ owns the fetch lifecycle. `load()` becomes
   * `refetch`, which kicks off a background refetch that leaves
   * the prior items on screen until the new payload lands. */
  const {
    items: skills,
    isLoading: loading,
    isLoadingMore,
    hasMore,
    loadMore,
    refresh: refetchSkills,
  } = useInfiniteApiQuery<Skill>(SKILLS_API, { limit: 20, params: skillsParams });
  /* skills installed from a URL (Agent Skills discovery index) */
  const skillSources = useSkillSources();
  const [showInstallUrl, setShowInstallUrl] = useState(false);
  const [installUrl, setInstallUrl] = useState("");
  const [updatesFor, setUpdatesFor] = useState<string[] | "all" | null>(null);

  const load = () => {
    void refetchSkills();
    void skillSources.refresh();
  };

  /* create dialog */
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createZip, setCreateZip] = useState<File | null>(null);
  const [createUploading, setCreateUploading] = useState(false);
  const [createDragOver, setCreateDragOver] = useState(false);
  const [createError, setCreateError] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

  /* detail dialog */
  const [detail, setDetail] = useState<Skill | null>(null);
  const [detailFiles, setDetailFiles] = useState<SkillFile[]>([]);
  const [detailVersions, setDetailVersions] = useState<VersionSummary[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequest = useRef(0);

  /* new version sub-form inside detail */
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [nvZip, setNvZip] = useState<File | null>(null);
  const [nvUploading, setNvUploading] = useState(false);
  const [nvDragOver, setNvDragOver] = useState(false);
  const [nvError, setNvError] = useState("");
  const nvInputRef = useRef<HTMLInputElement>(null);

  /* ---- loaders ---- */

  /* ---- create ---- */

  const resetCreate = () => {
    setCreateTitle("");
    setCreateZip(null);
    setCreateError("");
    setCreateDragOver(false);
    if (createInputRef.current) createInputRef.current.value = "";
  };

  // Validate file synchronously and set state. Returns true on success
  // so callers can know whether to clear the surrounding drop-zone state.
  const acceptCreateZip = (file: File): boolean => {
    if (!isZipFile(file)) {
      setCreateError(`"${file.name}" is not a .zip file`);
      return false;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setCreateError(
        uiText(`Zip is ${formatBytes(file.size)}, exceeds the ${formatBytes(MAX_UPLOAD_BYTES)} upload limit`),
      );
      return false;
    }
    setCreateError("");
    setCreateZip(file);
    return true;
  };

  const doCreate = async () => {
    if (!createZip) return;
    setCreateError("");
    setCreateUploading(true);
    try {
      const files = await extractManagedSkillFiles(createZip);
      await managedApi.skills.create({
        files,
        ...(createTitle.trim() ? { display_name: createTitle.trim() } : {}),
      });
      setShowCreate(false);
      resetCreate();
      load();
    } catch (e: any) {
      setCreateError(e?.message || uiText("Upload failed"));
    } finally {
      setCreateUploading(false);
    }
  };

  /* ---- detail ---- */

  const openDetail = async (skill: Skill) => {
    const request = ++detailRequest.current;
    setDetail(skill);
    setDetailFiles([]);
    setDetailVersions([]);
    setDetailLoading(true);
    setShowNewVersion(false);
    setNvError("");
    setNvZip(null);
    try {
      if (!skill.latest_version_id) throw new Error(uiText("Skill has no versions"));
      const [versionDetail, versionsRes, preview] = await Promise.all([
        managedApi.skills.versions.retrieve(skill.latest_version_id, {
          skill_id: skill.id,
        }),
        managedApi.skills.versions.list(skill.id, { limit: 100 }),
        managedApi.skills.versions
          .download(skill.latest_version_id, { skill_id: skill.id })
          .then(async (res) => ({
            files: readSkillArchivePreview(new Uint8Array(await res.arrayBuffer())),
          }))
          .catch((): Pick<VersionDetail, "files"> => ({ files: [] })),
      ]);
      if (request !== detailRequest.current) return;
      setDetail({
        ...skill,
        name: versionDetail.name,
        description: skillDescription(versionDetail.description, preview.files) ?? skillDescription(skill.description, []),
      });
      setDetailFiles(preview.files || []);
      setDetailVersions(versionsRes.data || []);
    } catch {
      // Keep the list metadata if version details are unavailable.
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    detailRequest.current++;
    setDetail(null);
    setDetailFiles([]);
    setDetailVersions([]);
    setShowNewVersion(false);
    setNvZip(null);
    setNvError("");
  };

  /* ---- new version ---- */

  const startNewVersion = () => {
    setNvError("");
    setNvZip(null);
    setNvDragOver(false);
    if (nvInputRef.current) nvInputRef.current.value = "";
    setShowNewVersion(true);
  };

  const acceptNvZip = (file: File): boolean => {
    if (!isZipFile(file)) {
      setNvError(`"${file.name}" is not a .zip file`);
      return false;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setNvError(
        uiText(`Zip is ${formatBytes(file.size)}, exceeds the ${formatBytes(MAX_UPLOAD_BYTES)} upload limit`),
      );
      return false;
    }
    setNvError("");
    setNvZip(file);
    return true;
  };

  const doNewVersion = async () => {
    if (!detail || !nvZip) return;
    setNvError("");
    setNvUploading(true);
    try {
      const files = await extractManagedSkillFiles(nvZip);
      await managedApi.skills.versions.create(detail.id, { files });
      setShowNewVersion(false);
      setNvZip(null);
      /* refresh both the list and this detail */
      load();
      const refreshed = await managedApi.skills.retrieve(detail.id);
      openDetail(refreshed);
    } catch (e: any) {
      setNvError(e?.message || uiText("Upload failed"));
    } finally {
      setNvUploading(false);
    }
  };

  /* ---- delete ---- */

  const deleteSkill = async () => {
    if (!detail) return;
    if (!confirm(uiText("Delete this skill? This cannot be undone."))) return;
    try {
      await managedApi.skills.delete(detail.id);
      closeDetail();
      load();
    } catch {}
  };

  // Row-level delete invoked from the per-row actions menu. Separate from
  // the modal's deleteSkill because the row's confirm copy uses the
  // skill's own title and there's no detail dialog to close after.
  const deleteSkillById = async (skill: Skill) => {
    const name = skill.display_name || skill.name;
    if (!confirm(uiText(`Delete ${name}? This cannot be undone.`))) return;
    try {
      await managedApi.skills.delete(skill.id);
      load();
    } catch {}
  };

  /* ---- helpers ---- */

  const inputCls =
    "w-full border border-border rounded-lg px-3 py-2 min-h-11 sm:min-h-0 text-sm outline-none focus:border-border-strong transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)] bg-bg text-fg";

  // TanStack column defs. Single table for both Anthropic built-in + custom
  // skills; the Source column lets the user tell them apart at a glance.
  // No click sort / no per-column filter — Source filter chip drives the
  // server `source` param instead.
  const columns = useMemo<ColumnDef<Skill>[]>(
    () => [
      {
        id: "name",
        accessorKey: "display_name",
        header: uiText("Name"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium text-fg truncate">
              {row.original.display_name || row.original.name || row.original.id}
            </div>
            <div className="text-xs text-fg-subtle font-mono truncate">
              {row.original.source?.type === "anthropic"
                ? row.original.name || row.original.id
                : row.original.id}
            </div>
          </div>
        ),
        enableHiding: false,
      },
      {
        id: "description",
        accessorKey: "description",
        header: uiText("Description"),
        size: 320,
        cell: ({ row }) => <SkillDescriptionCell skill={row.original} />,
      },
      {
        id: "source",
        accessorKey: "source",
        header: uiText("Source"),
        cell: ({ row }) => {
          const tracked = skillSources.locks.get(row.original.id);
          return row.original.source?.type === "anthropic" ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-subtle text-warning">
              {uiText("Built-in")}
            </span>
          ) : tracked ? (
            <span
              className="inline-flex max-w-48 items-center px-2 py-0.5 rounded-full text-xs font-medium bg-bg-surface text-fg-muted"
              title={tracked.source_url}
            >
              <span className="truncate">{sourceLabel(tracked.source_url)}</span>
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-bg-surface text-fg-muted">
              {uiText("Custom")}
            </span>
          );
        },
      },
      {
        id: "version",
        accessorFn: (s) => s.latest_version_id,
        header: uiText("Version"),
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {row.original.latest_version_id ? `v${row.original.latest_version_id}` : "—"}
          </span>
        ),
      },
      {
        id: "created",
        accessorFn: (s) => s.created_at,
        header: uiText("Created"),
        cell: ({ row }) => (
          <span className="text-fg-muted">
            {new Date(row.original.created_at).toLocaleDateString()}
          </span>
        ),
      },
    ],
    [skillSources.locks],
  );

  // Active-filter chip displays — kept undefined when matching the default
  // so the chip reads "Source ▾" rather than "Source: All ▾". The clear-X
  // only renders when the chip is in non-default state.
  const sourceDisplay =
    source === "any" ? undefined : SOURCE_OPTIONS.find((o) => o.value === source)?.label;

  const filters = (
    <FilterChip
      label={uiText("Source")}
      active={source !== "any"}
      display={sourceDisplay}
      onClear={() => setSource("any")}
    >
      <PopoverContent
        align="start"
        sideOffset={4}
        collisionPadding={8}
        className="w-48 p-0"
      >
        <FacetedFilter
          options={SOURCE_OPTIONS}
          value={source}
          onValueChange={(v) => setSource(v as SourceValue)}
          searchPlaceholder={uiText("Source...")}
        />
      </PopoverContent>
    </FilterChip>
  );

  const handleRowClick = (s: Skill) => {
    void openDetail(s);
  };

  /* ---- render ---- */

  return (
    <DataTable<Skill>
      subtitle={uiText("Manage pre-built and custom skills for your agents.")}
      createLabel={uiText("New skill")}
      onCreate={() => setShowCreate(true)}
      headerActions={
        skillSources.available ? (
          <>
            {skillSources.locks.size > 0 && (
              <Button variant="outline" onClick={() => setUpdatesFor("all")}>
                 {uiText("Check for updates")} </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setInstallUrl("");
                setShowInstallUrl(true);
              }}
            >
               {uiText("Install from URL")} </Button>
          </>
        ) : undefined
      }
      filters={filters}
      data={skills}
      loading={loading}
      hasMore={hasMore}
      loadingMore={isLoadingMore}
      onLoadMore={loadMore}
      getRowId={(s) => s.id}
      onRowClick={handleRowClick}
      rowActions={(skill) => [
        {
          label: uiText("Delete"),
          icon: <TrashIcon className="size-4" />,
          destructive: true,
          disabled: skill.source?.type === "anthropic",
          onSelect: () => void deleteSkillById(skill),
        },
      ]}
      columns={columns}
      emptyTitle={uiText("No skills yet")}
      emptyKind="skill"
      emptySubtitle={uiText("Create a skill to give your agents domain expertise.")}
      emptyAction={
        <div className="flex gap-2 justify-center">
          <Button onClick={() => setShowCreate(true)}>{uiText("+ New skill")}</Button>
          {skillSources.available && (
            <Button variant="outline" onClick={() => setShowInstallUrl(true)}>
               {uiText("Install from URL")} </Button>
          )}
        </div>
      }
    >
      <InstallFromUrlModal
        open={showInstallUrl}
        initialUrl={installUrl}
        onClose={() => setShowInstallUrl(false)}
        onInstalled={load}
      />
      <SkillUpdatesModal
        open={updatesFor !== null}
        skillIds={updatesFor === "all" || updatesFor === null ? undefined : updatesFor}
        onClose={() => setUpdatesFor(null)}
        onUpdated={() => {
          load();
          if (detail) void managedApi.skills.retrieve(detail.id).then(openDetail).catch(() => {});
        }}
        onInstallNew={(url) => {
          setUpdatesFor(null);
          setInstallUrl(url);
          setShowInstallUrl(true);
        }}
      />

      {/* ===== Create Dialog ===== */}
      <Modal
        open={showCreate}
        onClose={() => {
          if (createUploading) return;
          setShowCreate(false);
          resetCreate();
        }}
        title={uiText("Upload Custom Skill")}
        subtitle={uiText("Upload an Anthropic-style skill folder packaged as a .zip.")}
        maxWidth="max-w-xl"
        footer={
          <>
            <Button
              variant="ghost"
              disabled={createUploading}
              onClick={() => {
                setShowCreate(false);
                resetCreate();
              }}
            >
               {uiText("Cancel")} </Button>
            <Button
              onClick={doCreate}
              disabled={!createZip || createUploading}
              loading={createUploading}
              loadingLabel={uiText("Uploading...")}
            >
               {uiText("Upload")} </Button>
          </>
        }
      >
        <div className="space-y-4">
          {createError && (
            <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-lg px-3 py-2">
              {createError}
            </div>
          )}

          {/* Drop zone */}
          <DropZone
            file={createZip}
            dragOver={createDragOver}
            onDragOver={(over) => setCreateDragOver(over)}
            onFile={(f) => acceptCreateZip(f)}
            onClear={() => {
              setCreateZip(null);
              if (createInputRef.current) createInputRef.current.value = "";
            }}
            inputRef={createInputRef}
            disabled={createUploading}
          />

          {/* Display Title (optional override) */}
          <div>
            <Label className="text-sm text-fg-muted block mb-1">
               {uiText("Display Title")}{" "}
              <span className="text-fg-subtle">
                 {uiText("(optional — falls back to SKILL.md")} <code>name</code>)
              </span>
            </Label>
            <Input
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              className={inputCls}
              placeholder={uiText("Leave blank to use the skill's own name")}
              disabled={createUploading}
            />
          </div>

          <p className="text-xs text-fg-subtle">
             {uiText("The zip must contain")} <code>SKILL.md</code>  {uiText("at the root, or one top-level folder containing it (the common case when you")} <code> zip -r my-skill.zip my-skill</code>).
          </p>
        </div>
      </Modal>

      {/* ===== Detail Dialog ===== */}
      <Modal
        open={!!detail}
        onClose={closeDetail}
        title={detail?.display_name || detail?.name || detail?.id || ""}
        subtitle={detail ? `${detail.id} · v${detail.latest_version_id}` : ""}
        maxWidth="max-w-2xl"
        footer={
          <Button variant="ghost" onClick={closeDetail}>
             {uiText("Close")} </Button>
        }
      >
        {detailLoading ? (
          <div className="text-fg-subtle text-sm py-8 text-center">
             {uiText("Loading...")} </div>
        ) : detail ? (
          <div className="space-y-5">
            {/* Actions */}
            <div className="flex justify-end">
              <Button variant="destructive" size="sm" onClick={deleteSkill}>
                 {uiText("Delete")} </Button>
            </div>

            {/* Metadata */}
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-fg-muted block mb-0.5">
                   {uiText("Display Title")} </Label>
                <p className="text-sm font-medium">
                  {detail.display_name || "—"}
                </p>
              </div>
              <div>
                <Label className="text-xs text-fg-muted block mb-0.5">
                   {uiText("Name")} </Label>
                <p className="text-sm font-mono">
                  {detail.name || "—"}
                </p>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <Label className="text-xs text-fg-muted block mb-0.5">
                   {uiText("Description")} </Label>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-muted">
                  {detail.description || "暂无描述"}
                </p>
              </div>
              <div>
                <Label className="text-xs text-fg-muted block mb-0.5">
                   {uiText("Created")} </Label>
                <p className="text-sm text-fg-muted">
                  {new Date(detail.created_at).toLocaleString()}
                </p>
              </div>
            </div>

            {/* Source (installed from a URL) */}
            {skillSources.locks.get(detail.id) && (() => {
              const tracked = skillSources.locks.get(detail.id)!;
              return (
                <div className="border border-border rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <Label className="text-xs text-fg-muted">{uiText("Installed from")}</Label>
                    <Button size="sm" variant="outline" onClick={() => setUpdatesFor([detail.id])}>
                       {uiText("Check for updates")} </Button>
                  </div>
                  <p className="text-sm font-mono break-all">{tracked.source_url}</p>
                  <p className="text-xs text-fg-subtle">
                    <span className="font-mono">{tracked.name}</span>  {uiText("· digest")}{" "}
                    <span className="font-mono" title={tracked.digest}>
                      {tracked.digest.replace(/^sha256:/, "").slice(0, 12)}
                    </span>{" "}
                     {uiText("· updated")} {new Date(tracked.updated_at).toLocaleString()}
                  </p>
                </div>
              );
            })()}

            {/* Usage hint */}
            <div>
              <Label className="text-xs text-fg-muted block mb-1">
                 {uiText("Usage in Agent Config")} </Label>
              <pre className="whitespace-pre-wrap bg-bg-surface border border-border rounded-lg p-3 text-xs font-mono text-fg-muted">
{`"skills": [{ "type": "custom", "skill_id": "${detail.id}", "version": "latest" }]`}
              </pre>
            </div>

            {/* Files */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-fg-muted">
                   {uiText("Files (v")}{detail.latest_version_id})
                </Label>
                <Button variant="ghost"
                  onClick={startNewVersion}
                  className="inline-flex items-center min-h-11 sm:min-h-0 px-2 text-xs text-fg-muted hover:text-fg transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]"
                >
                   {uiText("+ New version")} </Button>
              </div>
              {detailFiles.length === 0 ? (
                <p className="text-xs text-fg-subtle">
                   {uiText("No files in this version.")} </p>
              ) : (
                <div className="space-y-2">
                  {detailFiles.map((f, i) => (
                    <div
                      key={i}
                      className="border border-border rounded-lg overflow-hidden"
                    >
                      <div className="bg-bg-surface px-3 py-1.5 border-b border-border text-xs font-mono text-fg-muted flex items-center justify-between">
                        <span className="truncate">{f.filename}</span>
                        {f.encoding === "base64" && (
                          <span className="ml-2 text-xs uppercase tracking-wider text-fg-subtle">
                            binary
                          </span>
                        )}
                      </div>
                      {f.encoding === "base64" ? (
                        <p className="px-3 py-2 text-xs italic text-fg-subtle">
                           {uiText("Binary file — not previewed.")} </p>
                      ) : (
                        <pre className="px-3 py-2 text-xs font-mono text-fg-muted whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                          {f.content}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* New Version sub-form */}
            {showNewVersion && (
              <div className="border border-border-strong rounded-lg p-4 bg-bg-surface/50 space-y-3">
                <h3 className="text-sm font-medium text-fg">
                   {uiText("Upload New Version")} </h3>
                {nvError && (
                  <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-lg px-3 py-2">
                    {nvError}
                  </div>
                )}
                <DropZone
                  file={nvZip}
                  dragOver={nvDragOver}
                  onDragOver={(over) => setNvDragOver(over)}
                  onFile={(f) => acceptNvZip(f)}
                  onClear={() => {
                    setNvZip(null);
                    if (nvInputRef.current) nvInputRef.current.value = "";
                  }}
                  inputRef={nvInputRef}
                  disabled={nvUploading}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    disabled={nvUploading}
                    onClick={() => {
                      setShowNewVersion(false);
                      setNvZip(null);
                      setNvError("");
                    }}
                  >
                     {uiText("Cancel")} </Button>
                  <Button
                    onClick={doNewVersion}
                    disabled={!nvZip || nvUploading}
                    loading={nvUploading}
                    loadingLabel={uiText("Uploading...")}
                  >
                     {uiText("Publish Version")} </Button>
                </div>
              </div>
            )}

            {/* Versions list */}
            <div>
              <Label className="text-xs text-fg-muted block mb-2">
                 {uiText("Version History")} </Label>
              {detailVersions.length === 0 ? (
                <p className="text-xs text-fg-subtle">
                   {uiText("No version history available.")} </p>
              ) : (
                <div className="border border-border rounded-lg overflow-x-auto">
                  <Table className="w-full text-sm">
                    <TableHeader>
                      <TableRow className="bg-bg-surface/60 text-fg-muted text-xs uppercase tracking-wider">
                        <TableHead className="text-left px-4 py-2">{uiText("Version")}</TableHead>
                        <TableHead className="text-left px-4 py-2">{uiText("Created")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detailVersions.map((v) => (
                        <TableRow
                          key={v.id}
                          className="border-t border-border"
                        >
                          <TableCell className="px-4 py-2 font-mono text-xs">
                            v{v.id}
                            {v.id === detail.latest_version_id && (
                              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-success-subtle text-success">
                                latest
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="px-4 py-2 text-fg-muted text-xs">
                            {new Date(v.created_at).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </DataTable>
  );
}

/* ---------- DropZone ---------- */

interface DropZoneProps {
  file: File | null;
  dragOver: boolean;
  onDragOver: (over: boolean) => void;
  onFile: (file: File) => boolean;
  onClear: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}

function DropZone({
  file,
  dragOver,
  onDragOver,
  onFile,
  onClear,
  inputRef,
  disabled,
}: DropZoneProps) {
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    onDragOver(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) onDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        onDragOver(false);
      }}
      onDrop={handleDrop}
      className={[
        "border-2 border-dashed rounded-lg px-4 py-6 text-center transition-colors duration-[var(--dur-quick)] ease-[var(--ease-soft)]",
        dragOver
          ? "border-brand bg-brand/5"
          : "border-border bg-bg-surface/30",
        disabled ? "opacity-60 pointer-events-none" : "",
      ].join(" ")}
    >
      <Input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {file ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-left">
            <div className="text-sm font-medium text-fg truncate">{file.name}</div>
            <div className="text-xs text-fg-subtle">{formatBytes(file.size)}</div>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => inputRef.current?.click()}
            >
               {uiText("Replace")} </Button>
            <Button variant="ghost" size="sm" onClick={onClear}>
               {uiText("Remove")} </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm text-fg-muted">
             {uiText("Drag &amp; drop a")} <code>.zip</code>{uiText(", or")} </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => inputRef.current?.click()}
          >
             {uiText("Choose file")} </Button>
        </div>
      )}
    </div>
  );
}
