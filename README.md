# dsh-tiaforge —— DeepSeek Harness 插件

把 TIA Forge 的**五个工具技能 + 一个学习教练**和**五个 MCP 端点**打成**一个组合包（bundle）**：
装一次，DSH 里就有「查文档 → 生成梯形图 → 看图核对 → 跑仿真 → 操作真实工程」这条链。

**三步装好**

| 步骤 | 做什么 | 说明 |
|:--:|---|---|
| **1** | 装包：DSH 左上角【插件】→ 输入 `dsh-tiaforge` → 安装 → **完全退出并重开** DSH | 命令行等价：`dsh plugin --profile web add dsh-tiaforge` |
| **2** | 配 Key（四个云端服务，微信扫码，各 **100 次免费**）：`npx dsh-tiaforge-setup` | 浏览器里填 URL/Key → 保存，**约 25 秒生效、不用重启** |
| **3** | 验通：模型侧能看到六个技能 + 已配好 Key 的服务 | 要操作**真实工程**得另装 [TiaLink 博途 MCP 网关](https://tia.hubwiz.com/tia-link?utm_source=npm&utm_medium=readme&utm_campaign=dsh-tiaforge)（Windows + 博途 V17–V21，¥99/月） |

> **汇智网（hubwiz.com）出品。** 装完看不到工具不是坏了：五个端点里有四个要 API Key，没配不报错、不发请求，只是对应工具不出现。

> **为什么需要它**：DSH 本身支持 skill（`ctx.skills` + 文件系统提供方，扫 `<project>/.dsh/skills`、`.agents/skills`、`~/.dsh/skills`），
> 但**没有 `dsh skill add` 这类命令** —— skill 只能靠"把文件放到扫描目录"或"插件注册"进来。
> 这个包用后者：`index.js` 在 `apply()` 里读包内 `skills/*/SKILL.md`，直接 `ctx.skills.register()`。
> 所以你不需要拷文件、也不需要配 `customSkillDirs`。

## 装

### A. 桌面端界面装（推荐，三步）

1. 点 DSH 左上角【插件】；
2. 输入 `dsh-tiaforge`；
3. 点安装 → **完全退出并重开** DSH（MCP 连接是在启动时建立的）。

装完模型侧就能看到 **六个技能**，配好 Key 的服务出工具。全程不用开终端、不用改配置文件。

### B. 命令行（写脚本、批量装、或 `dsh web` 里找不到插件入口时）

```sh
# 从 npm（预构建，推荐）
dsh plugin --profile web add dsh-tiaforge

# 从 GitHub（本仓库的 dsh-plugin 目录）
dsh plugin --profile web add github:tia-forge/tiaforge-plugins#path:dsh-plugin
```

装完重启 `dsh web`，并强刷浏览器。**之后改 Key / URL 都不再需要重启。**

## 它装了什么

| 类型 | 名称 | 说明 |
|---|---|---|
| 技能 | `tialink-tia-portal` | AI 操作博途工程（V17 / V18 / V19 / V20 / V21；未授权只读） |
| 技能 | `plc-cloud-sim` | 云端逐扫描仿真 + 场景 PASS/FAIL |
| 技能 | `laddoc-cloud` | LadDoc → 博途可导入 SimaticML |
| 技能 | `lad-render-cloud` | SimaticML → PNG，导入前先看一眼（**计费**，每次渲染扣 1 次） |
| 技能 | `tia-portal-docs` | 博途编程文档检索（`get_docs`） |
| 技能 | `plc-programming-ai-tutor` | 博途编程学习教练 |
| MCP | `tialink` | 网关（内置默认值 `http://127.0.0.1:8080/mcp`；网关在别的机器就改它，用 `tiaforge_set_endpoint` 或配置页） |
| MCP | `tia-docs` | `https://tia.hubwiz.com/ai-coding-docs/mcp` |
| MCP | `plc-sim` | `https://tia.hubwiz.com/sim/mcp` |
| MCP | `laddoc` | `https://tia.hubwiz.com/lad/mcp` |
| MCP | `lad-render` | `https://tia.hubwiz.com/render/mcp` |

## 配 Key：在对话里说一句（0.6.0，桌面端/无终端首选）

装完重开 DSH，直接在对话框里说：

> 帮我把 TIA Forge 配好

模型会调 `tiaforge_status` 看缺哪几把 → 让你去控制台点「复制」→ 你说一句「复制好了」→ 它调
`tiaforge_import_key` 从**系统剪贴板**取值写进凭据库，然后当场测一次连接 —— **Key 不进对话框、不进会话记录、也不发给模型**。

三个工具：

| 工具 | 干什么 | 什么时候用 |
|---|---|---|
| `tiaforge_status` | 报「就绪 n/5，缺哪几把」 | 每次配置的第一步 |
| `tiaforge_import_key` | 从剪贴板认出一把 Key（按 `tia_` / `sim_` / `lad_` / `render_` 前缀），写入并探测 | 用户说「复制好了」之后 |
| `tiaforge_import_env` | 从进程环境 / 项目 `.env` / `$DSH_HOME/.env` 搬进凭据库（**立即生效**，不需要重启） | Key 已经在 `.env` 里 |
| `tiaforge_set_key` | 直接收用户粘在对话里的 Key | **默认关闭**，`TIAFORGE_DIRECT_INPUT=1` 才注册；会提醒"已进会话记录" |

关掉整套：`TIAFORGE_TOOLS=0`（企业环境 / 不放行剪贴板读取时）。

## 配 Key / 改 URL（0.4.0 起：改完不用重启）

```sh
npx dsh-tiaforge-setup
```

它起一个**只绑 127.0.0.1** 的小页面（路径里带一次性 token，页面不加载任何外部资源），五行表单：

> 本地/开发版（还没发到 npm）时 `npx` 找不到这个包，直接用安装目录里的入口：
> `node ~/.dsh/profiles/web/node_modules/dsh-tiaforge/bin/setup.mjs`（Windows 把 `~` 换成 `C:\Users\<你>`）。

- **URL**：默认已填好；网关在另一台机器、或走内网代理时改这里；
- **Key**：粘贴即存，输入框不回显（留空 = 保持现状）；
- **测试连接**：当场握手一次，直接告诉你 `401（Key 无效）/ 404（URL 不对）/ 连不上（没启动）`；
- **保存**：写进 `$DSH_HOME/.credentials.yaml`（先备份一份 `.bak-<时间戳>`），dsh 监听该文件 → **约 25 秒生效**。

不想开页面也行，等价的三条路：

| 写法 | 生效方式 | 适合 |
|---|---|---|
| `npx dsh-tiaforge-setup` | 保存后 ~25 秒，自动重连 | 大多数人 |
| 直接编辑 `$DSH_HOME/.credentials.yaml` 的 `refs:` 分节 | 同上（凭据库 watch 这个文件） | 想在脚本里管、想 diff |
| `export TIA_DOCS_KEY=…`（或项目 `.env`） | **下次启动**生效 | CI、临时试 |

解析优先级是凭据库定的：**托管文件 > 启动环境 > 项目 `.env` > `$DSH_HOME/.env`**。所以老用户原来的环境变量照旧有效，不用迁移。

| 引用名 | 端点 | 免费额度 | 技能 |
|---|---|---|---|
| `TIA_DOCS_KEY` | `/ai-coding-docs/mcp` | 新用户 100 次免费 | `tia-portal-docs` |
| `TIA_SIM_KEY` | `/sim/mcp` | 100 次 | `plc-cloud-sim` |
| `TIA_LAD_KEY` | `/lad/mcp` | 100 次 | `laddoc-cloud` |
| `TIA_RENDER_KEY` | `/render/mcp` | 100 次 | `lad-render-cloud`（`render_version` 免费，渲染扣 1） |
| `TIALINK_TOKEN` | 本机 `:8080/mcp` | — | `tialink-tia-portal`（未授权只读） |

外加五个 `*_URL`（`TIALINK_URL`、`TIA_DOCS_URL`、`TIA_SIM_URL`、`TIA_LAD_URL`、`TIA_RENDER_URL`），默认值由插件首次启动**幂等播种**——已存在就不动。

### URL 还能从"插件配置"改（0.5.0 起，热生效）

五个 URL 同时是插件 Config 的 **volatile 字段**（`tialinkUrl` / `docsUrl` / `simUrl` / `ladUrl` / `renderUrl`）。这带来两个效果：

- **改配置即生效**：在 profile 的 `cordis.patch.yml` 里覆盖，或将来在 DSH 的配置界面里改，插件会把新值同步进凭据库，
  端点在约 25 秒内重连——**dsh 不用重启**（0.5.0 实测：`18402 → 18403`，进程 PID 未变）；
- **优先级**：配置字段（改过才算覆盖）> 凭据库文件里已有的值 > 内置默认值。把配置字段改回默认字符串 = 取消覆盖。

**Key 为什么不进配置**：DSH 的配置会落到 profile 的 `cordis.patch.yml`（明文），而 dsh 自己的规矩也是"配置只写引用、密钥进凭据库"。
所以 Key 的写入口只有两个：本机配置页（`npx dsh-tiaforge-setup`）或直接编辑 `.credentials.yaml`。

四把 Key 的领取地址：[/ai-coding-docs](https://tia.hubwiz.com/ai-coding-docs?utm_source=dsh&utm_medium=readme)｜[/sim](https://tia.hubwiz.com/sim?utm_source=dsh&utm_medium=readme)｜[/lad](https://tia.hubwiz.com/lad?utm_source=dsh&utm_medium=readme)｜[/render](https://tia.hubwiz.com/render?utm_source=dsh&utm_medium=readme)（微信扫码 → 控制台「更换密钥」，**Key 只显示这一次**）。

### 想清掉配置（重置 / 换机器）

```sh
# 只清 Key（保留 URL 和登录会话），并移除 TiaLink 令牌覆盖块
npx dsh-tiaforge-setup --clear

# 连 URL 一起清（下次启动会重新播种内置默认值）
npx dsh-tiaforge-setup --clear --all
```

两条都会先备份成 `.credentials.yaml.bak-<时间戳>`；`records:`（登录会话）和其它工具写的配置一个字节都不动。
等价的手工做法：删掉 `.credentials.yaml` 里 `refs:` 下属于 TIA Forge 的那几行，**别删整个文件**（会连带
`records.client-connection/browser-session` 一起丢，得重新扫码授权）。

### 没配 Key 会发生什么

- 那个端点**不注册工具**，也不会每 30 秒去撞 401（`waiting-credentials`，不消耗重连次数）；
- 技能照旧可用（技能正文是可读的知识，不依赖工具）；
- `npx dsh-tiaforge-setup --print` 随时看「就绪 n/5」；插件启动时也会在 stderr 打一行同样的摘要。

## 桌面端（Desktop）

Desktop 是 dsh Web 应用的 Electron 壳，**插件语义完全一致**（同一个共享插件管理器、同一个 profile runner），
只是 profile 目录不同：`$DSH_HOME/profiles/desktop`，且**由 Electron 独占**；凭据文件仍是 `$DSH_HOME/.credentials.yaml`（默认），所以 `npx dsh-tiaforge-setup` 一样能配。

> **走 A（界面安装）不会碰到下面这两条** —— 它们只在你用**命令行**往 Desktop 里装时才有关。

两个硬约束（官方 `apps/desktop/README.zh.md`）：

1. **先用 npm 装的 dsh 管不了它** —— 必须用 Desktop 自带的 CLI：菜单 →「检查更新…」下方「**管理 dsh 命令…**」→ 安装，然后新终端里 `dsh --version`。
2. **第一次要先用 Desktop 启动一次**（初始化 profile），然后**完全退出应用**，再执行安装命令。

```sh
# 1) 启动一次 Desktop 再完全退出
# 2) 装好 Desktop 自带 CLI 后：
dsh plugin --profile desktop add dsh-tiaforge
# 3) 重新打开 Desktop
```

Desktop 里没有"技能"页面——这不是缺功能：**技能是模型调用的**（`skill` 工具 + 目录注入），
本插件在 `apply()` 里注册，所以桌面端一样能用到，不需要任何 UI。

若安装被拒且报 `engines.dsh` 不匹配：Desktop 的 dsh 版本与打包版本严格一致，
升级 Desktop，或把 `package.json` 的 `engines.dsh` 放宽到覆盖你的版本。

## headless / sdk / acp

端点是**静态 `dsh-mcp-client` 行**（不是 `mcp-manager`），所以没有 Web 界面的 profile 也有工具。
代价是这些 profile 里不能通过 DSH 的界面改配置——用 `npx dsh-tiaforge-setup` 或环境变量。

## 验证

```sh
# 1) 组合后的配置里应该有 1 行技能 + 5 行端点
dsh --profile web --dump-config | grep -n tiaforge

# 2) 看现在配到哪一步了（不联网、不启动 dsh）
npx dsh-tiaforge-setup --print

# 3) 起来之后，模型侧应该能用 skill 工具看到六个技能
dsh web
#   对话里问：「列出你能用的 TIA 相关技能」
```

## 排错

| 现象 | 原因 / 怎么办 |
|---|---|
| 工具列表里没有 `mcp__tia-docs__*` | 没配 Key，或 Key 无效。跑 `npx dsh-tiaforge-setup`，点该行「测试连接」看是 401 还是 404 |
| 401 | Key 无效/过期，或复制时带了空格。控制台「更换密钥」后重新粘贴 |
| 404 | URL 少写/多写了路径（默认值见上表） |
| 连不上 / 超时 | 本机网关没启动（TiaLink 没开），或内网/代理不通 |
| 改了文件但工具没变 | 等 ~25 秒；仍不变就重启 dsh（`waiting-credentials` 之外的失败会走重连预算） |
| 端点"自己又回来了" | 五个 `*_URL` 缺失会被重新播种。**想停用一个端点请删它的 Key，不要删 URL** |

## 结构

```
dsh-plugin/
├── package.json           # dsh.bundle.patch = ./cordis.patch.yml；bin: dsh-tiaforge-setup
├── cordis.patch.yml       # 1 行技能注册插件 + 5 行 mcp-client（全部走 ${credential:…}）
├── index.js               # 技能注册；URL 的 Config 字段（volatile）；URL→凭据库同步；就绪摘要
├── lib/refs.mjs           # 五个端点的唯一真源（ref 名、默认 URL、配置字段名）
├── lib/credentials-file.mjs # 逐行编辑 .credentials.yaml（不动别人写的字节）
├── lib/keys.mjs           # Key 前缀识别 / 格式校验 / 掩码
├── lib/clipboard.mjs      # 读系统剪贴板（win: Get-Clipboard；mac: pbpaste；linux: wl-paste/xclip）
├── lib/probe.mjs          # 端点探针（配置页与对话工具共用）
├── lib/setup-tools.mjs    # 三个对话式配置工具
├── bin/setup.mjs          # 本地回环配置页 + 测试连接
├── assets/setup.html      # 那张表单
├── test/                  # node --test：配置面一致性 + 凭据文件编辑器
└── skills/<slug>/SKILL.md
```

`cordis.patch.yml` 只 `insert` 新行、**不覆盖任何已有行**，所以 dsh-base / web-app 升级时这个包最不容易坏。

## 兼容性

- `engines.dsh: ">=0.2.0-rc.0 <0.2.1-rc.0 || >=0.2.1-rc.0 <0.3.0"`（0.1.1 起）。**两个分支是必需的**：node-semver 只允许某个比较符元组与版本 tuple 完全一致且自带预发布标签时才放行预发布版，单个 `>=0.2.1-rc.1 <0.3.0` 会把 `0.2.0-rc.2` 这类版本静默排除。
- 0.4.0 实测：**dsh 0.2.2-rc.5**（Windows 11 / Node 24）。改 Key 后 25 秒内重连；无 Key 时零请求。
- 0.5.0 实测：在 profile 的 `cordis.patch.yml` 里改 `docsUrl`，30 秒内凭据库与端点都跟着变，**dsh 进程没重启**（volatile 热生效）。
- 0.6.0 实测：三个对话式工具在 rc.5 上注册成功（启动日志 `已注册对话式配置工具：…`），29 个单元测试全绿。
- 0.4.0 依赖两条 dsh 服务：`skills`（技能注册表）与 `credentials`（凭据库）。两者都在 `dsh-base` 里，随所有官方 profile 提供；自制极简 profile 缺 `credentials` 时端点行会停在等待状态（不会崩）。
- 升级 DSH 后先跑一次 `--dump-config`，确认 6 行还在，再开始用。

## 许可

插件代码 MIT；技能正文 CC BY 4.0（见各 `SKILL.md`）。TiaLink 网关与四个云端服务是商业软件/服务，不在本许可范围内。
