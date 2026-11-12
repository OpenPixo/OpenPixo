# 对话里直接展示生成的图片 + 常驻运行状态行

> 用户原话(2026-11-03):「生成出来的图片、sprite 这些东西能直接展示出来。另外希望能有一个地方
> 一直展示当前整体在干什么，因为有些小白用户可能看不太懂整体的运行状态」。
> 本文记录这两件事的判据、位置和取舍。代码:`runtime/chat/turn-assets.ts`、
> `runtime/chat/run-status.ts`、`components/chat/AssetGallery.tsx`、`components/chat/RunStatusLine.tsx`。

## 1. 改之前的样子

- 生图行(组件 12,`ImageRow`)住在执行记录**里面**。一条 todo 做完那一段就收起,一轮跑完整张壳收起,
  刚生成的立绘 / sprite / 贴图跟着看不见了。轮末 daemon 结算 `producedFiles` 之后,图片才以 16:10 的
  产物卡出现(一张一卡,没有棋盘底,sprite 不播放)。
- 「现在在干什么」只有执行记录壳头的「进行中」和 Plan 药丸的「第 N / M 步」。药丸只在有清单、
  在跑、贴着底时出现,往上一滚就让位给「回到最新」。没有清单的轮次没有任何一句人话。

## 2. 消息里那排图(`AssetGallery`)

### 2.1 检测规则(session 7「agent 自主生图」对齐这一节)

只认**这一轮事件里的生成证据**,按事件先后去重(同一项目相对路径只出一格):

1. **生图行的完成格**。`buildTurnBlocks` 产出的 `ImageRow`,`surface === 'image'`,`cells` 里
   `status === 'done'` 且带 `path` 的格子(没有 `cells` 时用 `thumbs`)。生图行的判据在
   `build-turn-blocks.ts` 的 `readImageCall`,本功能不另写一份:
   - 命令工具(`Bash` / `PowerShell` / `shell` …,见 `tool-kind.ts` 的 `isCommandTool`)的 `command`
     含 `media generate`,且不含 `--help`(`isMediaGenerateCommand`,已导出,唯一出处);
   - daemon 媒体任务(`GET /api/projects/:id/media/tasks`,`runId` 等于这一轮)优先:
     `task.file.name` 是格子的路径,`batchId` / `batchIndex` / `batchSize` 决定格子数和位置,
     `surface` 决定是不是图片;
   - 没有任务时读工具结果的**逐行 JSON**:`status` 为 `done|succeeded|completed|ok` 的行算一张,
     路径依次取 `file.name`、`path`、`file`、`outputPath`、`url`;
   - 结果是交棒行(`{"taskId":…,"status":"running",…}`)时读这一轮 `media wait` 等到的结局:
     `{"file":…}` 算一张、`status: failed|interrupted` 算失败;没等到时轮次还在跑就是进行中,
     轮次结束了就回落成普通工具行。不看退出码:`media wait` 退出 2 是「还在跑」;
   - 这一轮任务的 `media wait` 不单独落行(管线),别的任务的那一行退出 2 也不算失败;
   - 同一个 `--output` 的再次生成在跑或成功了,前一次失败不落行(`supersededRetryIds`),
     它的任务也算用掉了,不会被后一次取走;
   - 结果被打码、但入参带 `file_path` 的单张生成,用那个 `file_path`。
   - 托管生图(OpenPixo 积分,`openpixo-image-*`)走同一条 `pixo media generate` / 媒体任务管线,
     不需要新判据。
2. **写图片文件的工具行**。`ToolRow.tool` 为 `write` / `edit`,`file` 后缀是
   `png|jpg|jpeg|webp|gif|bmp|avif|svg`,调用已回来且没失败,路径能正面证明属于当前项目
   (`openableRecordFilePath`:绝对路径只认 `resolvedDir` 前缀,点开头的目录不算)。
3. **轮末的快照**(2026-11-06 加,`withCheckpointAssets`)。这一轮新增或改过的媒体文件:脚本写出来、
   事件里没有证据的图(`python make_sprite.py`)靠它出现。只补不减,排在事件证据之后。
4. **不认 `producedFiles`**。它仍归产物卡(有版本快照、`<pixo-focus show>` 的聚焦裁决)。
   这里出过的文件从产物卡里**摘掉**(`withoutGalleryImages`),同一个文件不在一条消息里画两遍。

三类媒体共用这套判据(`TurnAsset.kind`):生图行按 `surface` 分的格子也出音频和视频,写文件的工具行
和快照按后缀认。

**session 7 要做的**:agent 生图只要走 `pixo media generate`(带 `--surface image`,结果打印逐行
JSON 或让媒体任务带上 `runId`),缩略图自动出现。若另起一条生成通道,要么在事件里留下上面两种证据之一,
要么在 `turn-assets.ts` 里补一条规则并在这一节登记,不要在组件里另判。

### 2.2 画法

- 位置:壳外、结论段之后、产物卡之前;一轮在跑时就出现(只收**已出来**的图),不随壳收起。
  还在生成的格子、失败的格子(带重试)留在执行记录的生图行里。
- 一张:200px 高的单格;多张:`minmax(96px, 1fr)` 的方格网格,最宽 480px。
  一轮写出很多时只摆前 24 张(音频 8、视频 4),其余一句话指到改动和文件视图。
- 加载失败:格子大小不变,写文件名和「加载失败」,不可点。大图浮层同样写一句话。不留破图。
- 音频(`AudioArtifact`):文件名、时长、波形。波形来自解码文件本身(`useAudioPeaks`,40MB 以上或解码失败
  时回落到稳定的占位波形),同时是进度条:点、拖、方向键都能跳。播不了时整条换成一句话。
- 视频(`VideoArtifact`):内联播放器,封面是视频自己的第一帧(`#t=0.1`)。盒子固定 16:9,
  元数据到了也不改高度,流式进行中不会把内容顶走。播不了时盒子里写一句话。
- 棋盘底(`--chat-checker-a/b`,亮暗两个作用域都定义);≤256px 的图按最近邻放大(和资产面板
  `isPixelAsset` 同一条线)。
- sprite:图片几何像帧带(长边是短边的整数倍)时才去问资产索引 `GET /api/projects/:id/assets/info`;
  有声明的帧(Aseprite / TexturePacker JSON、Godot `SpriteFrames`、Unity meta、用户设的网格)就按帧
  循环播放(每帧时长优先,默认 10fps),角上标「N 帧」;没有声明时只认「≥3 个正方形格子」的条带,
  两格的宽图不猜。滚出视口不播;`prefers-reduced-motion` 时格子不播、浮层默认暂停。
- 点一格:大图浮层(`Dialog`,`chatSeam` 补上 `--chat-*` 接缝),棋盘底、尺寸 / 帧数 / 第几张、
  左右键翻页、sprite 播放 / 暂停、「下载」「在文件中打开」。
- 卡面读这一轮的 ready 快照(`artifactRefs` → `snapshotUrl`),没有就读工作区当前文件;
  「在文件中打开」永远开工作区最新那份 —— 与产物卡同一条裁决(`artifact-refs.ts`)。
- 重开会话:全部来自持久化事件,画法与实时一致。

## 2b. 这一轮改了哪些文件(`TurnChanges`)和工具行里的代码

用户原话(2026-11-06):「agent 改了代码,但在界面上看不到」。根因见
`specs/current/openpixo-game-panel.md` §5。

- **消息里常驻一块**:执行记录一轮跑完就收起,所以「改了 N 个文件」在壳外。只在一轮结束后出现,
  跑着的时候文件行就在摊开的记录里。一行一个文件:状态、路径、增删行数,点开是这一轮的 diff;
  最新一轮还有「查看改动」。数据与回落规则在 `runtime/chat/turn-changes.ts`:有快照用快照,
  没有就用写 / 改工具行和轮末产出,这时点开的是文件本身。
- **源代码不再出大卡片**:它们进这一块,哪怕 agent 写进了 `<pixo-focus show>`(真机上常见,卡上只有文件名和
  〔导出〕)。文档(md、txt……)没人声明也进这一块,agent 用 `show` / `open` 明说的才出卡。
  (2026-08-26 的「变成卡片形式」说的是当时那份灰色列表,现在有更合适的归宿。)
- **工具行展开看内容**:写、改、读的调用入参和结果里带着内容的(`runtime/chat/tool-preview.ts`),
  点这一行就地展开:项目相对路径、复制、带颜色的代码或改动。还在写的那一行不展开,否则一路变高、
  下面的内容跟着跳。正文限高 280px 自己滚,最多画 400 行。入参里没有内容时(Codex 的 `file_change`
  只留两个数字)这一行不能展开,点文件名去面板看 diff。
- **文件名是 diff 的入口**:这一轮改过它又有快照,点文件名开 diff,否则开文件(`AssistantMessage`
  的 `openRecordFile`)。媒体永远开文件。
- **命令块**:命令按工具名高亮(Bash / PowerShell),整段是 JSON 的输出按 JSON 高亮,普通日志不着色。
  复制命令、复制输出、展开是悬停才出现的工具(`CommandBody`)。
- **语法高亮**:`runtime/shiki.ts`。用完整 bundle,语法各自一个 chunk,第一次用到才加载,所以有 C#、
  GDScript、HLSL。高亮算好之前画纯文本,字宽行高一样,落下来时不跳。

## 2c. 这一轮用了哪些技能(`TurnSkills`)

用户原话(2026-11-07):「不是特别感受到 skill 的作用」。执行记录一轮跑完就收起,里面那行
「使用技能」也只认命令工具,所以用了也看不出来。

- **位置**:消息开头,执行记录之前,一轮在跑时就出现。没有证据就不出现,不占位。
- **判据**(`runtime/chat/turn-skills.ts`,事件里的证据,按先后去重):
  - daemon 把正文放进 prompt 的:`skills_loaded`(用户选的、recipe 和插件带的、触发词命中的);
  - agent 读了 `.pixo-skills/<技能>-<哈希>/SKILL.md` 的:命令工具看命令,Read 这类工具看路径。
    读失败、读附属文件、写这个文件都不算。
  - **只是列在清单里不算用过**。默认清单每轮都有,算进去这一行就没有意义了。
- **名字**:事件里只有 id,显示名随界面语言(`chat/SkillNames.tsx`,由 `ChatPane` 从技能目录提供),
  目录里没有的显示 id。执行记录那行「使用技能 · ××」用同一个来源。
- 项目绑定的技能(`project.skillId`,`@` 选过一次就会写上)每轮都算用过,这是实话:它确实每轮都在 prompt 里。

## 3. 常驻运行状态行(`RunStatusLine`)

### 3.1 位置与决策:**放在药丸旁边,不扩展药丸**

- 它挂在 `composerNode` 里、输入框正上方,一行定高(24px),永远在。
- 不扩展 Plan 药丸,原因:药丸只在「跑着 + 有清单 + 贴底」时出现,上滚让位给「回到最新」、跑完就走;
  这一行要的恰恰是永远看得见,而且没有清单的轮次也得有话说。把药丸改成常驻会打掉 `chat-bottom-float-slot`
  的「二选一」设计和 14 个钉着它的测试。两者分工:药丸答「第几步」并保留悬停清单;这一行答
  「此刻在干什么」,当前步骤名只当细节,**不再写 N/M**。
- 滚动管线:它在 `chat-composer-slot`(或 portal 出去的 `chat-composer-fixed-layer`)里,那个插槽已经在
  `ChatPane` 的 ResizeObserver 名单上、挂载由面板级 MutationObserver 跟踪(`syncComposerSlot`),
  所以不需要自己的 `containerRef`。高度恒定,本来也不会触发跟随。
- 不跑秒:壳头已有一只表,两只表起点不同(轮次 vs 壳)会对不上。

### 3.2 判据(`deriveRunStatusLine`,前面的压住后面的)

1. 轮次已停:还有没回答的 `<question-form>`(`conversationAwaitsAnswer`:末尾到下一条用户消息之间
   有完整表单)→ 等待你回答问题;成功 → 已完成;失败 → 运行出错了;取消 → 已停止;没有轮次 → 就绪。
2. 轮次在跑(`streaming` 或 `runStatus` queued / running):
   等审批(`RunApprovals` 上报的待审数)→ 等待你确认操作;断线重连 → 正在重新连接;
   有发出去还没回来的调用 → 按**最后发出**的那个归类;本轮媒体任务还有没结束的 → 正在生成;
   最后事件是正文 → 正在回复;其余 → 正在思考;一个事件都没有 → 正在准备。
3. 调用归类(`activityForTool`):TodoWrite → 规划;Web 工具 → 网上查资料;`media generate` → 生成;
   命令里认出构建 / 测试(`npm test|build`、`vitest`、`tsc`、`vite build` …)→ 检查代码能否跑通;
   安装(`npm i`、`pnpm add`、`pip install` …)→ 安装依赖;预览(`npm run dev`、`vite`、`http.server`、
   `godot` …)→ 运行游戏预览;其余按 `toolKind`:读 → 查看项目文件、搜 → 查找文件、
   写 / 改代码文件 → 编写代码、写图片 → 生成图片、写其他 → 写文件、`exec` → 执行命令、认不出 → 正在处理。
4. 生成进度:只信媒体任务(最新未结束任务所在的 `batchId` 那一批,N = 完成数,M = `batchSize`);
   没有任务时只用命令里 `media generate` 的次数当总数(「共 N 个」),不编 N;总数 1 不写进度。
5. 细节:当前那一步(显式 `in_progress` 优先,否则第一条 `pending`),优先 TodoWrite 的 `activeForm`。
   与状态词相同时不说两遍。

## 4. 验证

- 纯函数:`tests/runtime/chat/run-status.test.ts`、`tests/runtime/chat/turn-assets.test.ts`(喂真实
  `buildTurnBlocks` 输出)。
- 组件:`tests/components/chat/run-status-line.test.tsx`(含 ChatPane 内的四个时刻)、
  `tests/components/chat/asset-gallery.test.tsx`(含 AssistantMessage 恢复、快照、产物卡去重)。
- 目视:手写的 claude 回放(`mocks/` 渲染器新增可选 `result_after_ms`,让调用在途一段时间),
  种子图片经 `POST /api/projects/:id/files` 上传。没有任何真实模型调用。

## 5. 没做 / 待定

- 生图行在壳内展开时与缩略图会同时可见一小段时间(那一段 todo 还开着);todo 一关就只剩缩略图。
  若要完全去重,需要让生图行在完成后只留一行摘要,属于执行记录的设计改动,待产品定。
- 「继续未完成任务」(T33)仍没有入口;状态行是一个候选位置,未接。
