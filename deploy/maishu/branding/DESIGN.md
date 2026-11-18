---
name: 麦枢 / MAISHU
description: 清晰可读的执行控制台
colors:
  navy: "#152b46"
  navy-hover: "#213f62"
  gold: "#c7952c"
  gold-text: "#8c681e"
  paper: "#f8fafd"
  mist: "#eef2f8"
  white: "#ffffff"
  ink: "#1a2742"
  muted: "#5b6982"
  line: "#d7e0eb"
  line-strong: "#a8b8cd"
  on-dark: "#f3f6fb"
  muted-dark: "#b1c3d9"
  brand-subtle: "#e8eff8"
  row-hover: "#edf2f8"
  row-selected: "#e5edf7"
  success: "#24694a"
  success-subtle: "#eaf4ee"
  warning-subtle: "#fbf2dc"
  danger: "#a43e42"
  danger-subtle: "#fceff0"
  info: "#315f94"
  info-subtle: "#edf3fb"
  dark-canvas: "#101f33"
  dark-surface: "#1c314a"
  dark-line: "#344a64"
  dark-line-strong: "#6b829f"
  dark-brand: "#e5c17b"
  dark-brand-hover: "#f0d49f"
  dark-brand-subtle: "#2c3c50"
  dark-row-hover: "#1d344f"
  dark-row-selected: "#263f59"
  sidebar-hover: "#213b58"
  sidebar-selected: "#2d4055"
  dark-success: "#a3d0b8"
  dark-success-subtle: "#1d3d36"
  dark-warning-subtle: "#3e3525"
  dark-danger: "#f0a7ae"
  dark-danger-subtle: "#442b39"
  dark-info-subtle: "#223b59"
typography:
  overview-title:
    fontFamily: "\"Noto Serif SC\", \"Songti SC\", \"SimSun\", serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.5
  title:
    fontFamily: "\"Noto Serif SC\", \"Songti SC\", \"SimSun\", serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.5
  title-mobile:
    fontFamily: "\"Noto Serif SC\", \"Songti SC\", \"SimSun\", serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.5
  panel-title:
    fontFamily: "\"Noto Serif SC\", \"Songti SC\", \"SimSun\", serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "30px"
  prose:
    fontFamily: "\"Noto Serif SC\", \"Songti SC\", \"SimSun\", serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.8
  body:
    fontFamily: "\"Noto Serif SC\", \"Songti SC\", \"SimSun\", serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: "26px"
  label:
    fontFamily: "\"Noto Serif SC\", \"Songti SC\", \"SimSun\", serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "24px"
  kpi:
    fontFamily: "\"Noto Serif SC\", \"Songti SC\", \"SimSun\", serif"
    fontSize: "36px"
    fontWeight: 600
    lineHeight: 1.2
  mono:
    fontFamily: "ui-monospace, \"SFMono-Regular\", Menlo, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
rounded:
  control: "4px"
  route: "6px"
  popover: "8px"
spacing:
  stage: "8px"
  gap: "12px"
  item: "16px"
  panel: "20px"
  group: "24px"
  frame-medium: "28px"
  frame: "40px"
components:
  button-primary:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.on-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.navy-hover}"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
    height: "44px"
  input:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
    height: "44px"
  navigation-active:
    backgroundColor: "{colors.sidebar-selected}"
    textColor: "{colors.dark-brand}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: "44px"
  resource-badge:
    textColor: "{colors.muted}"
    typography: "{typography.mono}"
    rounded: "{rounded.control}"
    padding: "2px 8px"
    height: "44px"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.route}"
  kpi:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.kpi}"
    padding: "20px 24px"
---

# Design System: 麦枢

## Overview

**Creative North Star: "清晰可读的执行控制台"**

麦枢采用独立产品符号，沿用小麦知行的深蓝、麦金、纸白和 Noto Serif SC。深蓝建立导航与品牌识别，浅底承载执行配置、会话与资源信息；真实状态、操作反馈和阅读层级优先。

当前默认采用六方案中的 01「枢心」：M 形结构与麦金节点。它与母品牌共享色彩和字体，不复制母品牌四麦粒标识。本文件记录已实现的控制台规范；母品牌 VI 和上游 PRODUCT.md 分别保留原有职责。

**Key Characteristics:**

- 深蓝导航与纸白工作面，深色模式使用真正的深色画布。
- 统一宋体，以字号、字重与间距建立层级。
- 小圆角、细分隔线与平面容器。
- 键盘焦点、禁用、加载和空状态具有明确反馈。

## Colors

前置令牌为实际用色；CSS 语义变量由 `theme.css` 按浅色、深色和深蓝导航作用域切换，新增页面应复用语义变量。

### Primary

- **知行深蓝 / 悬停深蓝**（navy / navy-hover）：浅色工作区主操作、品牌结构；导航在两种主题下均维持深蓝。

### Secondary

- **麦金 / 可读金字**（gold / gold-text）：产品节点与少量强调；浅底金色文字使用可读派生色。
- **深底浅金**（dark-brand / dark-brand-hover）：深色主操作、导航选中和深底焦点。

### Neutral

- **纸白 / 雾蓝灰 / 控件白**（paper / mist / white）：阅读画布、背景分区和控件底面。
- **墨蓝 / 阅读灰 / 浅分隔线**（ink / muted / line / line-strong）：主字、辅助信息、边界。
- **深底主字 / 深底次字**（on-dark / muted-dark）：深蓝和深色表面文字。
- **深色画布 / 深色表面 / 深色线条**（dark-canvas / dark-surface / dark-line / dark-line-strong）：深色模式层级。
- **行悬停 / 行选中**（row-hover / row-selected 及 dark 对应项）：只表达当前交互状态；导航使用自身 sidebar 对应项。

成功、警告、错误和运行信息分别使用 success、gold-text、danger、info 及对应淡底；深色模式采用 dark 对应项，警告文字使用 dark-brand，信息文字使用 muted-dark。状态必须同时具有可读名称。

**The Gold Legibility Rule.** 麦金用于节点和少量强调；浅底小字使用 gold-text，深底选中与焦点使用 dark-brand，不能用亮金替代所有正文。

## Typography

**Display Font:** Noto Serif SC，回退到 Songti SC、SimSun、serif。

**Body Font:** 同一字体栈，常用字重 400–600，禁用字体合成。

**Label/Mono Font:** 中文辅助说明仍用品牌字体；代码和 ID 使用 ui-monospace、SFMono-Regular、Menlo、Consolas、monospace。

### Hierarchy

- **Title**：概览标题使用 overview-title；设置和详情主标题使用 title，手机使用 title-mobile。
- **Panel Title**：面板标题使用 panel-title。列表页既有标题为 28px / 42px；不把页面标题机械放大为营销封面。
- **Prose**：解释段落使用 prose；手机概览解释降为主 UI 尺寸。
- **Body / UI**：导航、表格、输入和主要控件使用 body；辅助信息使用 label。
- **KPI**：统计数值使用 kpi，等宽数字；手机为 32px / 38px，标签仍保持辅助字号。

本地 `fonts/noto-serif-sc.woff2` 为单一可变字体（2,501,816 字节，约 2.5 MB），覆盖 GB2312 与当前控制台 807 个汉字，已检查缺字为零。未知用户输入的罕见汉字和 emoji 可回退到系统字体，不宣称完整字库。许可证随 `fonts/OFL.txt` 提供；字库和覆盖证据见 `fonts/coverage.json`。

**The One Font Source Rule.** 运行时只使用一个共享品牌 WOFF2；新增文案后复查缺字，代码与 ID 使用系统等宽，罕字和 emoji 允许系统回退。

## Layout

桌面沿用左侧导航、顶部面包屑和独立内容滚动区。侧栏默认 264px，可调范围 220–320px；顶栏 56px，壳体间隙 8px。概览内容最大宽度 1440px，设置表单最大宽度 880px；内容边距默认 40px，1199px 及以下为 28px，767px 及以下为 20px。

主要控件与导航行高 44px，数据行高 52px，表头高 42px。组间留白 24px，控件组常用 12px；面板和设置内容使用 20–24px 内边距。图标按钮与会话输入器的紧凑工具区保留各自既有尺寸，44px 是主操作控件规范。

概览四项统计在桌面并列，767px 及以下为 2×2，手机单元最小高度 112px。手机导航采用可关闭抽屉；表格在容器内横滚，概览最近会话表最小宽度 580px。接入说明在 1000px 及以下转为单列。不得让表格产生整页横向溢出。

## Elevation & Depth

工作区与普通信息面板保持平面；通过底色、间距和细线表达层级，不添加玻璃、辉光和强阴影。 工作区路由阴影已关闭（`--shadow-route: none`）；对话框、菜单和手机抽屉保留既有浮层阴影，用于明确覆盖关系，不扩散到普通面板。登录只沿用指定 VI 的右上柔光深蓝背景，不将渐变扩展到每张卡片。

**The Flat Working Surface Rule.** 工作区与普通信息面板保持平面；通过底色、间距和细线表达层级，不添加玻璃、辉光和强阴影。

交互延续既有快速反馈，快速、基础和慢速时长分别为 150ms、180ms、220ms；不增加入场编舞。全屏启动加载使用麦枢标志；紧凑控件沿用既有省略点加载提示。`prefers-reduced-motion: reduce` 下停用平滑滚动，并将动画与过渡缩至近乎即时。

## Shapes

控件、输入和行选中采用小圆角（control）；路由和普通面板采用 route，菜单及对话框采用 popover。手机路由表面取消圆角。统计区使用平直分隔线，没有独立浮起卡片。边界通常为细实线，避免用大胶囊包裹每条信息。

产品标志保持 M 形轮廓与下方独立金色节点，不拉伸、裁切、描边或添加辉光。生产资产包括浅底 `logo.svg`、深底反白 `logo-dark.svg`、单色 `logo-mono.svg`、`favicon.svg` 以及转曲组合字标 `wordmark.svg` / `wordmark-dark.svg`。深蓝导航始终使用反白图标。组件现有图标高度为 24、28、32、44px；favicon 使用专门资产，不以完整字标硬缩。

## Components

### Buttons

主操作使用深蓝底与浅色文字，悬停使用语义品牌悬停色；深色模式使用浅金主操作。次操作使用细线或透明底，悬停使用雾蓝灰。小圆角、主要控件最小 44px；键盘焦点为金色轮廓，浅底 2px 轮廓与 3px 偏移，深蓝导航使用浅金焦点。禁用保留约半透明反馈，全屏启动加载使用麦枢标志；紧凑控件沿用既有省略点加载提示，按钮加载时防止重复提交。

### Inputs / Fields

细线输入、品牌字体、辅助色占位文字，最小高度 44px；登录输入为 48px。焦点具有金色外轮廓，并保留现有边框反馈；错误使用 danger 语义，禁用状态降低透明度。长代码和 ID 使用系统等宽。

### Navigation

深蓝侧栏、浅色主字、蓝灰次字；悬停提亮底面，选中使用浅金文字与更亮的深蓝底。标签使用主 UI 字号，分组说明使用辅助字号。选中同时以当前位置语义标记；手机延用抽屉和明确关闭入口。

### Chips / Tags

状态标签用文字与语义淡底表达成功、警告、错误、运行或闲置；运行状态允许既有提示点，减少动态效果时停止其持续动作。资源标签只有在可点击时呈现按钮悬停与焦点；纯信息标签保持静态，不增加假操作反馈。

### Cards / Containers

面板使用纸白或对应深色路由表面、细边线与小圆角。标题区左右分工清楚，标题与说明保持两级字体；内容区用分隔线衔接。统计区为一组平面单元，悬停只切换行底色和数值色，值缺失时显示短横线，不补造数据。

### Empty States

空资源与筛选无结果分别解释。文件列表无匹配时显示「没有匹配的文件」，提示修改搜索或清除筛选，并提供「清除搜索与筛选」；真正无文件时保留上传 API 与 SDK 说明。空状态应与用户当前条件对应。

## Do's and Don'ts

### Do:

- **Do** 沿用深蓝、麦金、纸白与独立「枢心」符号，按背景选择标志版本。
- **Do** 保持主 UI 16px、辅助 14px，并在手机检查标题、表格和控件可读性。
- **Do** 保持主要控件至少 44px；为键盘操作提供清楚的焦点。
- **Do** 使用真实资源与运行状态，并让筛选无结果提供恢复入口。
- **Do** 新增文案后复核字体覆盖，并尊重减少动态效果设置。

### Don't:

- **Don't** 把母品牌四麦粒标识复制成麦枢的新产品标志。
- **Don't** 将亮金色直接用于浅底小正文，或仅用颜色区分状态。
- **Don't** 添加渐变文字、玻璃面板、额外辉光和无作用的入场编舞。
- **Don't** 用虚构统计、运行状态或营销口号填充控制台。
- **Don't** 让数据表撑宽整页；窄屏在表格容器内横向滚动。

来源：本目录 `theme.css`、`fonts/coverage.json`、标志资产；`apps/console/src/index.css`、`components/Logo.tsx`、`components/ConsoleSurface.tsx`、`components/ui/button.tsx`、`components/ui/input.tsx`、`components/Badge.tsx`、`styles/console-*.css`、`pages/Dashboard.tsx`、`pages/FilesList.tsx`（相对仓库根目录 `work/oma`）。方向合同为本目录 `.impeccable/surfaces/console.md`；母品牌来源为「小麦知行_设计系统与VI_v1」的 DESIGN.md 与 VI.md。本文件不替代母品牌规范。
