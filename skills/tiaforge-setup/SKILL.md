---
name: tiaforge-setup
description: 帮用户把 TIA Forge 的五个 MCP 端点配好（API Key / URL）。用户说"配一下""Key 填哪""配置 TIA""工具看不到"时用这个技能；先用 tiaforge_status 查缺哪把，再让用户复制 Key（不要让他粘贴到对话里），用 tiaforge_import_key 从剪贴板写入，最后报掩码与测试连接结果。改 URL 用配置页或凭据引用 TIA_*_URL。
whenToUse: 用户提出配置 TIA Forge / 填 API Key / 改端点 URL / 某个 mcp__ 工具不出现 / 401 / 连不上时。
---

# 配置 TIA Forge（对话式）

这个插件接五个 MCP 端点：`tialink`（本机网关）、`tia-docs`、`plc-sim`、`laddoc`、`lad-render`。
每个端点要一把 Key 才出工具；**没有 Key 的端点不会注册工具，也不会打 401**。

## 铁律（先看完再动手）

1. **绝不让用户把 Key 粘贴到对话里。** Key 只要贴进对话，就会进会话记录并发送给模型服务商。
2. **只在用户明确说"复制好了 / 我复了 / copied"之后才调用 `tiaforge_import_key`**（它读系统剪贴板）。
3. **任何回执只报掩码**（如 `sim_…ab12`），永不回显原文。
4. 读不到剪贴板（远程桌面、无桌面会话、Linux 缺 `wl-paste`）→ 退到"手改文件"或"打开本机配置页"，别反复试。
5. 用户坚持要直接贴 Key 时才能用 `tiaforge_set_key`（默认未注册；注册了也要先提醒"会进会话记录"）。

## 工具报错时：三句以内，**禁止自查**

配置过程中唯一会报错的地方是"端点连不上"。照下表回，别自己排查：

| 报错 | 你说什么 | 
|---|---|
| `mcp-client(tialink): server is disconnected` | 先用 `tiaforge_set_endpoint({server:"tialink", url: 当前地址})` 探一次，**照抄探测结论**：拒绝连接=网关没启动/端口错；超时=不在同一内网或防火墙；401=要令牌；404=路径少写 `/mcp` |
| 其它 `mcp-client(...)` 报错 | 原样转述一句 + 一个二选一：「要我继续查，还是你直接告诉我配置？」 |
| 工具调用本身失败（参数/权限） | 一句话说明 + 换 `tiaforge_import_env` 或让用户手填 |

**绝对禁止**（这轮里模型做过，全是浪费）：编辑 `.credentials.yaml` 或任何配置文件（改地址有 `tiaforge_set_endpoint`）、`ls` / `find` / `grep` / `cat` 配置文件、`curl` 探活、读 `.credentials.yaml`、
在 `app.asar` 之类安装目录里找东西、**调 `mcp__tialink__*` 去"验证一下"**（网关没启动时它必然报 disconnected）。

**一次配置请求最多 2 次工具调用**，同一个工具不要连续调两次。超了就是跑偏。

## 最短路径（先看这张表，别自由发挥）

| 用户说 | 你做什么 | 禁止 |
|---|---|---|
| 「帮我配置 tialink」/「配一下本机网关」 | 调 **1 次** `tiaforge_status`，然后**把返回值里的 `say` 原句照抄**（最多再加一句追问） | 不要自己组织事实句（因果与责任一律照抄 `say`）、不要报默认地址、不要 curl/探活、不要 grep 或读配置文件、不要问选择题、不要调用 tialink 的工具去试 |
| 「帮我配一下 TIA Forge」 | 调 **1 次** `tiaforge_status` → 按它返回的 `next` 说 | 同左；一次只问一把 Key |
| 「我复制好了」 | 调 **1 次** `tiaforge_import_key` → 报掩码 + 连通性 | 不要再问属于哪把（工具会按前缀认）；不要再调 status |
| 「Key 已经写进 .env」 | 调 **1 次** `tiaforge_import_env` → 报导入了哪些 | 不要读 .env 内容、不要把值说出来 |
| 「网关在 192.168.x.x」/「地址不对」 | 调 **1 次** `tiaforge_set_endpoint({server,url})` → **照抄它返回的探测结论**（它写完会当场探测） | **不要编辑 `.credentials.yaml`**、不要读插件源码/patch 去推"值存在哪"、不要自己 curl 试探 |

**硬上限：一次配置请求最多 2 次工具调用**（1 次 status + 1 次导入）。超过就说明你在乱探。
`tiaforge_status` 的返回值里已经有 `next` 和每个端点的 `hint`，照着说就行，不要重新推理。

## 标准流程

1. **先查**：调 `tiaforge_status` → 得到"就绪 n/5"和缺哪几个。只问缺的那几个。
2. **说清楚**：告诉用户去哪里拿（微信扫码，各 100 次免费）：

   | 将来用到的工具 | Key | 领取地址 |
   |---|---|---|
   | `mcp__tia-docs__*` | `TIA_DOCS_KEY` | https://tia.hubwiz.com/ai-coding-docs/dashboard |
   | `mcp__plc-sim__*` | `TIA_SIM_KEY` | https://tia.hubwiz.com/sim/dashboard |
   | `mcp__laddoc__*` | `TIA_LAD_KEY` | https://tia.hubwiz.com/lad/dashboard |
   | `mcp__lad-render__*` | `TIA_RENDER_KEY` | https://tia.hubwiz.com/render/dashboard |
   | `mcp__tialink__*` | `TIALINK_TOKEN` | 本机 TiaLink 客户端 |

   并要求：**在控制台点「复制」，不要复制到剪贴板以外的地方，也别贴给我。**

   **TiaLink 是例外**：它的令牌（`TIALINK_TOKEN`）没有可识别前缀，从网关控制台（安装包 `README.txt` §6）复制后，
   调用工具时必须显式带 `ref: "TIALINK_TOKEN"`，否则会被判成"认不出是哪把 Key"。

### 第一次提问：照这个模板，别自己编选项

用 `ask_user_question` 一次问清"Key 现在哪儿"，三个选项**照抄**（越短越好）：

**题干里必须带一句**：`（别在这个输入框里贴 Key——贴进来就会进会话记录）`

| 选项 | 描述（一句话） |
|---|---|
| 已复制到剪贴板（推荐） | 我直接读剪贴板导入，Key 不会出现在对话里，导完立刻测连通性。 |
| 还没 Key | 我给你一个领取链接，领完复制，回来说一声就行。 |
| 已经写进 .env | 告诉我路径，我从文件导入（只回掩码）。 |

**不要**在选项描述里承诺"帮我把占位配置先搭好"——URL 首次启动已经自动写好了，没有任何占位工作需要做，
那句承诺只会让用户以为还差东西。

### 如果有人把 Key 直接打在回答框里

1. **别拿它去配**（哪怕工具可用）。先明确告诉他：这把 Key 已经进了会话记录，也会随请求发给模型服务商；
2. 让他回控制台**换一把**（「更换密钥」），新的那把走剪贴板；
3. 不要在别的地方复述它、不要写进任何文件、不要用它做演示。

（默认连 `tiaforge_set_key` 都没注册；只有部署方显式 `TIAFORGE_DIRECT_INPUT=1` 时才存在。）

### 用户答「还没 Key」：三行以内收住，不要列表格

照这个顺序说，别加东西：

1. 一句链接（**只给一个**，先给它就好）：
   `https://tia.hubwiz.com/ai-coding-docs/dashboard`（微信扫码，100 次免费；其它四个等服务跑通再说）
2. 一句动作：**打开页面 → 点「复制」→ 回来说一声「复制好了」**。
3. 一句兜底：这会儿不配也能用技能（读文档、写 SCL 这些不需要 Key 的部分照做）。

禁止：列四五个端点清单、讲 `lad-render` 计费细节、让用户一次领四把、说"我帮你把配置先搭好"。
用户回来时只需说一句，你调 `tiaforge_import_key` 就够了——那一步是秒级的，不会慢。

3. **导入**：用户说复制好了 → 调 `tiaforge_import_key`（可带 `ref`，不带就按前缀自动识别：`tia_` / `sim_` / `lad_` / `render_`）。
4. **报结果**：掩码 + 测试连接结论；成功就说"约 25 秒后工具出现，不用重启"。
5. **一把一把来**：不要一次问四把；每次只处理当前这把。

## 用户已经把 Key 放在 `.env` 或环境变量里

调 `tiaforge_import_env`（可传 `refs`）。它从进程环境、项目 `.env`、`$DSH_HOME/.env` 里读，
搬进凭据库后**立即生效**——比让用户重启 dsh 好，因为 `.env` 只在启动时读。

## 只想用本机网关（不领四把云 Key）

完全可以，这也是最省的组合：

1. `TIALINK_URL` 首启会自动播种一个内置默认值——**但不要把这个默认值念给用户**，
   当前实际地址以 `tiaforge_status` 返回的 `url` / `say` 为准（用户可能早已改成内网 IP）；
2. 只补 `TIALINK_TOKEN`：用户从网关控制台复制令牌 → `tiaforge_import_key({ ref: "TIALINK_TOKEN" })`；
3. 四个云端 Key 不配 = 那四个端点**不注册工具、不发请求、不扣额度**。
   （四个云端点一个口径：新用户 100 次免费，每次调用扣 1 次额度；原话照抄 `tiaforge_status` 的 `billing`。）

这两件事的关系**由工具返回值讲**，你不要自己在回复里组织这段话（历史上就错在这）：

- 用户看到的说明以 `say` 为准；

- **令牌** = 网关鉴权（`Authorization: Bearer`）。网关开了鉴权时，没令牌会连不上/回 401；去网关控制台复制，回来说一声即可。
- **许可** = 能不能**写**。未授权（没买许可）时网关只读，不会改工程。这跟令牌无关，也不是我们这边能配的。

填了令牌之后插件会给 tialink 那行补上 Authorization（写进 `$DSH_HOME/cordis.patch.yml` 的标记块，一样热生效）。

## 改 URL（内网、自建、网关在另一台机器）

URL 是插件的配置字段（`tialinkUrl` / `docsUrl` / `simUrl` / `ladUrl` / `renderUrl`），
也可以直接写进凭据库的 `TIA_*_URL`。两种方式改完都是**约 25 秒生效、不用重启**。

- 用户在 DSH 配置界面改 → 插件自动同步进凭据库；
- 用户想手改 → 指引他打开本机配置页：`npx dsh-tiaforge-setup`（本地开发包用
  `<profile>/node_modules/dsh-tiaforge/bin/setup.mjs`），或直接编辑 `$DSH_HOME/.credentials.yaml` 的 `refs:` 分节。

## 排错口径（照这个说，别自己编）

| 现象 | 说法 |
|---|---|
| 401 | Key 无效或复制时带了空格；回控制台「更换密钥」拿一把新的 |
| 404 | URL 路径不对（默认值见 `tiaforge_status` 返回的 `url`） |
| 连不上 / 超时 | 网关没启动（TiaLink 客户端）或内网不通 |
| 工具已经配了但模型看不到 | 可能是本轮会话的工具列表还是旧的：让用户新开一轮对话或重启 dsh |
| 用户问"会不会泄露" | 如实说：走 `tiaforge_import_key` 的 Key 只进本机凭据库，不进对话；走 `tiaforge_set_key` 的会进会话记录 |

## 收尾

配完提醒一句：**没配的端点不扣额度**。要讲计费就照抄 `tiaforge_status` 的 `billing` 字段——
四个云端点一个口径：**新用户 100 次免费，每次调用扣 1 次额度**。不要自己补充"哪个工具不计费"这类推断。
