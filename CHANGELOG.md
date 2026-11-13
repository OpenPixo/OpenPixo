# Changelog

## OpenPixo 1.0.5

- A new game is made with you, one step at a time: gameplay, art style, engine, plan, then one stage at a time. Each step waits for your OK. You pick the look from 2–3 sample images, and after each stage the AI tells you how to try it before going on.
- Auto is the new default credits model: Claude Sonnet 5.5 writes a new game's plan, and DeepSeek V4.1 Flash does everything else. You can still pick a model yourself.
- The AI can now see pictures when it uses DeepSeek V4.1 Flash: your screenshots, its own art and how the game looks while it plays it. Set a style reference image, and the AI uses it when it makes new art.
- Art spending: choose **Ask me first** (the AI lists the art it wants to make and waits) or **Spend within budget**.
- Moving characters get real animation frames, and a set of small images is made together at the price of one. **Check animation frames** and **Align animation frames** fix frames that jump or slide.
- The **Generate** tab makes images, sound effects, voice, music and 3D models in one place, and recipes can now use your credits at a price you see first.
- **Export playable game** saves a web game as one HTML file that plays offline. Double-click it or send it to a friend.
- Pixel-art games stay sharp and their text stays readable.
- OpenPixo starts faster on Windows, and the update button no longer covers the window buttons.
- Fixes for long Codex conversations, slow Codex sign-in checks, games that would not build or playtest, and faster switching between conversations.

This build is not code signed yet. Windows may show "Unknown publisher" the first time you run the installer; choose **More info**, then **Run anyway**. Windows with Smart App Control turned on will block it.

- 新游戏和你一起一步步做：玩法、画风、引擎、计划，然后一次做一个阶段，每一步都等你同意。画风从 2–3 张样图里挑；每个阶段做完，AI 会告诉你怎么试玩，再继续。
- 新的默认积分模型「自动」：新游戏的计划由 Claude Sonnet 5.5 来写，其余交给 DeepSeek V4.1 Flash。你仍然可以自己选模型。
- 用 DeepSeek V4.1 Flash 时 AI 能看图了：你的截图、它自己做的美术、试玩时游戏的样子。设一张风格参考图，AI 做新美术时会参考它。
- 做素材怎么花积分：选「先问我」（AI 先列出要做的素材，等你同意），或「在预算内直接做」。
- 会动的角色有真正的动画帧；同一画风的一组小图一起做，只花一张图的钱。「检查动画帧」和「对齐动画帧」能修好跳动、滑步的帧。
- 「生成」页可以做图片、音效、配音、音乐和 3D 模型；配方现在也能用积分，花多少先告诉你。
- 「导出可玩版本」把网页游戏存成一个能离线玩的 HTML 文件，双击就能玩，也能直接发给朋友。
- 像素风游戏画面保持清晰，字也看得清。
- 在 Windows 上启动更快；更新按钮不再挡住窗口右上角的按钮。
- 修复了 Codex 长对话出错、Codex 登录检查太慢、游戏构建或试玩失败等问题，切换对话也更快。

这个版本还没有代码签名。第一次运行安装包时，Windows 可能提示“未知发布者”，请点“更多信息”，再点“仍要运行”。开启了智能应用控制（Smart App Control）的 Windows 会直接拦截。

## OpenPixo 1.0.4

- Online features for web games: ask the AI for a leaderboard, racing ghosts (race a friend's best lap) or async battles (your saved team fights other players while you are away). Players don't sign in; each gets a generated name. It works on your public link with nothing to set up, and it is included in your plan.
- Try online features before publishing: the Share dialog adds 20 test players, shows what is stored and clears test data.
- More public games: when your plan's public games are all in use, publish another one for 100 credits, charged once. Updating it stays free.
- Clearer first run for people new to AI tools: the welcome screen explains what each way in costs and needs, plans and one-time credit packs sit side by side with their payment methods (packs take Alipay), and Home says what to do when no AI is ready yet.
- "Copy for your AI": if a command-line tool is missing, copy a ready-made message into an AI app you already have, and it installs and signs in the tool for you.

This build is not code signed yet. Windows may show "Unknown publisher" the first time you run the installer; choose **More info**, then **Run anyway**. Windows with Smart App Control turned on will block it.

- 网页游戏的在线功能：让 AI 加排行榜、赛车幽灵车（跟朋友的最好成绩比）或异步对战（你存好的队伍在你不在时和别的玩家对战）。玩家不用登录，系统会给每人起一个名字。发布到公开链接后直接能用，不用任何设置，包含在你的套餐里。
- 发布前先试：分享窗口里可以加 20 个测试玩家、查看存了什么、清空测试数据。
- 更多公开游戏：套餐里的公开游戏用满后，可以花 100 积分再发布一个，只扣一次，以后更新免费。
- 第一次使用更清楚：欢迎页说明每种方式要花什么、需要装什么；套餐和一次性积分包放在一起，并写明支付方式（积分包支持支付宝）；还没有可用的 AI 时，首页会告诉你下一步怎么做。
- “复制给你的 AI”：缺少命令行工具时，复制一段写好的话给你已有的 AI 应用，它会帮你安装并登录。

这个版本还没有代码签名。第一次运行安装包时，Windows 可能提示“未知发布者”，请点“更多信息”，再点“仍要运行”。开启了智能应用控制（Smart App Control）的 Windows 会直接拦截。

## OpenPixo 1.0.3

- Games run without installing anything: OpenPixo now includes Node.js, so web and Phaser games install and start right away. In mainland China, game packages download from a domestic mirror.
- Starting a new game is simpler: one question per screen, and you pick how big the game is (a few hours, a couple of weeks, or a month or more). The questions about stores, Steam and price are gone.
- If it is your first game, you choose from 2D games in Phaser or Godot, with a plain explanation of each.
- If the engine you picked is not installed, OpenPixo says so before creating the game and helps you install it or switch to one that runs.
- The AI plans with you one step at a time: gameplay, then art, then engine, waiting for your answer each time. Quick games plan in one short round.
- The model list only shows tools you have installed. Each credits model shows roughly how much it costs compared with DeepSeek V4.1 Flash, and new accounts start on DeepSeek V4.1 Flash. DeepSeek V4 Pro has been removed; if you used it, you are moved to V4.1 Flash.
- Tuning: drag the divider between the game and the tuning panel, and see more settings at once.

This build is not code signed yet. Windows may show "Unknown publisher" the first time you run the installer; choose **More info**, then **Run anyway**. Windows with Smart App Control turned on will block it.

- 不用再装任何东西就能运行游戏：OpenPixo 自带 Node.js，网页和 Phaser 游戏可以直接安装依赖并启动。在中国大陆，游戏用到的包会从国内镜像下载。
- 新建游戏更简单：一屏一个问题，先选游戏大小（几个小时、一两周或一个月以上）。去掉了在哪里发售、Steam 和价格这些问题。
- 第一次做游戏时，只需要在 Phaser 或 Godot 的 2D 游戏里选，每个都有简单说明。
- 选的引擎这台电脑上还没装时，创建前就会告诉你，并帮你安装或改用能直接运行的引擎。
- AI 和你一步步规划：玩法、美术、引擎，每一步都等你回答。快速试玩的游戏只规划一轮。
- 模型列表只显示已安装的工具。每个积分模型旁边显示大约是 DeepSeek V4.1 Flash 的多少倍消耗，新账号默认用 DeepSeek V4.1 Flash。去掉了 DeepSeek V4 Pro，之前用它的会自动换成 V4.1 Flash。
- 调参：游戏画面和调参面板之间可以拖动调整高度，一屏能看到更多参数。

这个版本还没有代码签名。第一次运行安装包时，Windows 可能提示“未知发布者”，请点“更多信息”，再点“仍要运行”。开启了智能应用控制（Smart App Control）的 Windows 会直接拦截。

## OpenPixo 1.0.2

- Security fix: updates the built-in web server to close a critical hole. Please update.
- Pick a quality for 3D models made with credits, from a quick rough shape to high detail.
- Edit a message you already sent and send it again. You can also roll back the files that reply changed.
- Press Esc to stop a reply, and ↑ to bring back your last prompt.
- Type `/` in the chat box for quick commands: `/new`, `/model`, `/undo`, `/run`, `/verify` and `/playtest`.
- Dots in the sidebar show which chats are waiting for you, still running or have a new reply. The taskbar shows progress and flashes when a reply is done.
- A cleaner window: a new title bar, resizable side panels, slightly larger text, and menus for reasoning effort and approvals.
- Help opens the support page and the changelog.

This build is not code signed yet. Windows may show "Unknown publisher" the first time you run the installer; choose **More info**, then **Run anyway**. Windows with Smart App Control turned on will block it.

- 安全修复：更新了内置的网页服务，修补一个严重漏洞，请尽快更新。
- 用积分生成 3D 模型时可以选质量，从快速出个大形到高细节。
- 已发出的消息可以编辑后重新发送，还可以撤回那次回复改动的文件。
- 按 Esc 停止回复，按 ↑ 找回上一条提示。
- 在输入框里输入 `/` 使用快捷命令：`/new`、`/model`、`/undo`、`/run`、`/verify` 和 `/playtest`。
- 侧栏的小圆点告诉你哪个对话在等你、还在运行或有新回复。任务栏会显示进度，回复完成时会闪烁。
- 界面更清爽：新的标题栏，可拖动调整的侧面板，字号稍大，推理强度和审批模式改成了菜单。
- 帮助菜单可以打开支持页和更新日志。

这个版本还没有代码签名。第一次运行安装包时，Windows 可能提示“未知发布者”，请点“更多信息”，再点“仍要运行”。开启了智能应用控制（Smart App Control）的 Windows 会直接拦截。

## OpenPixo 1.0.1

- Turn one image into a textured 3D model, with credits or your own key, and rotate it right in the app.
- Make sound effects, voice lines and music with credits.
- Generate opens at once and shows an approximate cost with one click. Recipes are grouped by what you are making, and their forms read in Chinese.
- Files made with credits now download straight to your PC.
- Godot starters include what a game for sale needs from the first scene.
- Unity projects now get the same game-dev skills as Godot and Phaser, with Unity-specific guidance.
- OpenPixo has its own icon and start screen.

This build is not code signed yet. Windows may show "Unknown publisher" the first time you run the installer; choose **More info**, then **Run anyway**. Windows with Smart App Control turned on will block it.

- 用一张图生成带贴图的 3D 模型，可以用积分或你自己的 Key，还能在应用里直接旋转查看。
- 用积分制作音效、配音和音乐。
- 生成页打开更快，点一下就能看到大致费用。配方按你要做的东西分组，表单也有中文了。
- 用积分生成的文件现在直接下载到你的电脑。
- Godot 起步模板从第一个场景起就带着发售游戏需要的东西。
- Unity 项目现在也能用和 Godot、Phaser 一样的游戏开发 skill，并带有专门的 Unity 指引。
- OpenPixo 有了自己的图标和启动画面。

这个版本还没有代码签名。第一次运行安装包时，Windows 可能提示“未知发布者”，请点“更多信息”，再点“仍要运行”。开启了智能应用控制（Smart App Control）的 Windows 会直接拦截。

## OpenPixo 1.0.0

The first public release, for Windows.

- Plan a new game in chat: talk through gameplay, art and engine, approve a short plan, then build.
- Use your own Codex, Claude Code or OpenCode, or sign in and use hosted AI models with credits.
- Generate images and other game assets with credits, and approve an art budget so the agent can make art for your game.
- See what each turn changed: changed files and generated media appear right in the chat.
- Share a Web game through a public link, and let players join multiplayer rooms.
- Change your plan inside the app. Your balance updates by itself.
- Updates download in the background and apply when you restart.

This build is not code signed yet. Windows may show "Unknown publisher" the first time you run the installer; choose **More info**, then **Run anyway**. Windows with Smart App Control turned on will block it.

首个公开版本，支持 Windows。

- 在聊天里规划新游戏：先聊玩法、美术和引擎，批准一份简短计划，然后开始做。
- 可以用自己的 Codex、Claude Code 或 OpenCode，也可以登录后用积分使用托管 AI 模型。
- 用积分生成图片等游戏素材。批准美术预算后，agent 可以直接为游戏做美术。
- 每一轮改了什么一目了然：改动的文件和生成的媒体都显示在聊天里。
- 通过公开链接分享 Web 游戏，并让玩家加入联机房间。
- 在应用内更改套餐，余额会自动刷新。
- 更新在后台下载，重启后生效。

这个版本还没有代码签名。第一次运行安装包时，Windows 可能提示“未知发布者”，请点“更多信息”，再点“仍要运行”。开启了智能应用控制（Smart App Control）的 Windows 会直接拦截。
