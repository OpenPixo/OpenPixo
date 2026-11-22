# Changelog

## OpenPixo 1.0.10

- **Style samples that look like real games.** While planning, the art step draws key screens with a lit play area, a quieter background and detail where it matters, and you can ask for as many rounds of samples as you need.
- **Side-scroller animation.** Walk, idle and attack animations for games seen from the side, made from one picture of your character. The AI now knows these animations can be made with credits instead of saying it can't.
- **Two story starters.** New Godot and Phaser visual novels that already play, ready to rewrite into your own story.
- **Steer a running Codex turn.** 「引导对话」 now puts your message into the turn Codex is working on, and it keeps going. Where the AI can't take a message mid-turn, the button says **Stop and send** and asks first.
- **Fewer interruptions with Codex.** Godot checks and playtests no longer ask for approval each time, and each new turn in a long Codex conversation starts about a minute sooner. OpenPixo's Codex conversations now also show in your own Codex app's thread list.
- **Busy model, calm message.** When the AI provider is overloaded, OpenPixo retries a few times by itself. If it still can't connect, it says your work is saved and offers **Continue**.
- **Art you approved is not asked for twice.** If a turn could not make all the art you approved, the rest carries over to the next turn.
- **Steadier credits art.** A reference picture whose upload failed once now heals on the next try, and a short cloud hiccup is retried before anything is charged.
- Pictures the AI puts in its reply show in the chat.
- Version history stays fast in large game folders, and builds, engine caches and very large files are left out of it.
- A signed-in Codex is no longer missed on a slow check, so you are not asked to pay for art Codex can draw.
- Chinese folder names from the folder picker stay intact, and a folder OpenPixo can't use says why.
- A calmer, more consistent look across the app.

This build is not code signed yet. Windows may show "Unknown publisher" the first time you run the installer; choose **More info**, then **Run anyway**. Windows with Smart App Control turned on will block it.

- **画风样图更像真正的游戏。** 规划时的画风步骤会画出主画面：游玩区域有光，背景退后，细节放在该有的地方；样图想重画几轮都可以。
- **横版动画。** 横版游戏可以用一张角色图做出行走、待机和攻击动画。AI 现在知道这些动画能用积分生成，不会再说做不了。
- **两个剧情游戏模板。** 新增 Godot 和 Phaser 视觉小说模板，打开就能玩，可以直接改成你自己的故事。
- **引导正在运行的 Codex。** 「引导对话」现在会把你的消息送进 Codex 正在做的这一轮，它会接着做。AI 不能中途接收消息时，按钮显示「停止并发送」，并先问你一次。
- **用 Codex 时打断更少。** Godot 检查和试玩不再每次都要你批准；长对话里每一轮新开始大约快一分钟。OpenPixo 的 Codex 对话现在也会出现在你自己的 Codex 应用的对话列表里。
- **模型繁忙时说清楚。** AI 服务商太忙时，OpenPixo 会自己重试几次；仍然连不上时，会告诉你已经做好的部分都保留着，并给出「继续」。
- **批准过的美术不会再问一次。** 如果这一轮没能做完你批准的美术，剩下的额度会留给下一轮。
- **积分生图更稳。** 参考图上传失败过一次后，下次会自动修好；云端短暂出错时，会在扣费前先自动重试。
- AI 在回复里放的图片会显示在对话中。
- 大型游戏文件夹里的版本记录保持流畅，打包输出、引擎缓存和超大文件不再记录进去。
- 已登录的 Codex 不会因为检查慢而被漏掉，不会再让你为 Codex 能免费画的图付费。
- 用文件夹选择器选的中文文件夹名不再出错；OpenPixo 用不了某个文件夹时会说明原因。
- 整个应用的界面更安静、更一致。

这个版本还没有代码签名。第一次运行安装包时，Windows 可能提示“未知发布者”，请点“更多信息”，再点“仍要运行”。开启了智能应用控制（Smart App Control）的 Windows 会直接拦截。

## OpenPixo 1.0.9

- **A clearer first screen.** Two ways in, each saying what it costs: **OpenPixo credits** (recommended, nothing to install, sign in inside) or **your own AI accounts**, which now says plainly it is not free and needs a terminal. Unless Codex or Claude Code is already signed in on your computer, a short check asks for a paid AI account and a terminal before setup starts, with a way back to credits.
- **See prices before you sign in.** A pricing page shows every plan and credit pack: what size of game each plan is for, the price in dollars with an estimate in your own currency, the bonus credits a plan gives over packs, about how many images, sound effects and 3D models that buys, how many games you can share, and the AI models you can use. Choose one and sign in; the plan screen opens on it.
- Card, Apple Pay and Google Pay are shown for plans, and Alipay for credit packs. Paying with Alipay? The monthly plans point you to credit packs.
- Prices show a plain "$" instead of "US$".
- Codex image jobs run on the Codex model you picked.
- Installing a game's packages keeps package caches and stores out of the game folder, its version history and the file list.
- Images made by the AI's batch scripts count in the chat as they finish.
- A first-time user's new game uses only the app's language, and the first-run screens say plainly when Codex's model is not on your ChatGPT plan.
- OpenPixo is now licensed under the Functional Source License 1.1, which becomes Apache-2.0 two years after each release. Versions up to 1.0.8 stay Apache-2.0, and skills, plugins and templates stay Apache-2.0 because they go into your games.

This build is not code signed yet. Windows may show "Unknown publisher" the first time you run the installer; choose **More info**, then **Run anyway**. Windows with Smart App Control turned on will block it.

- **首屏更清楚。** 两条路，各自写明花费：**OpenPixo 积分**（推荐，不用安装，直接登录）或**使用你自己的 AI 账号**，现在直接说明这条路并不免费，还需要用到终端。除非你的电脑上已经登录了 Codex 或 Claude Code，开始设置前会先简单确认你有付费 AI 账号、会用终端，也可以随时改用积分。
- **登录前就能看价格。** 价格页列出所有套餐和积分包：每个套餐适合做多大的游戏，美元价格和你所在地货币的估算，套餐比积分包多送的积分，大约能生成多少张图、多少个音效和 3D 模型，能分享多少个游戏，以及可以使用的 AI 模型。选好后登录，套餐页会直接选中它。
- 套餐显示银行卡、Apple Pay 和 Google Pay，积分包另外支持支付宝。想用支付宝时，按月订阅会提示你改买积分包。
- 价格显示为 "$"，不再写 "US$"。
- Codex 生图使用你选择的 Codex 模型。
- 安装游戏依赖时，包缓存和包仓库不再放进游戏文件夹、版本历史和文件列表。
- AI 用批量脚本生成的图片，每完成一张就会在对话里计数。
- 新手的新游戏只使用应用的语言；当 Codex 的模型不在你的 ChatGPT 套餐里时，首次使用页面会直接说明。
- OpenPixo 改用 Functional Source License 1.1 授权，每个版本发布两年后转为 Apache-2.0。1.0.8 及更早的版本仍是 Apache-2.0；技能、插件和模板仍是 Apache-2.0，因为它们会进到你的游戏里。

这个版本还没有代码签名。第一次运行安装包时，Windows 可能提示“未知发布者”，请点“更多信息”，再点“仍要运行”。开启了智能应用控制（Smart App Control）的 Windows 会直接拦截。

## OpenPixo 1.0.8

- **Game hub** in the left bar, after the Workshop: every game you shared in one place, how often it was played this month, and who played together. Copy the link, play it, or open the game from its card; the monthly limit for playing together, the link and **Stop sharing** sit under **Settings**. Links whose project you deleted, or that you published from another computer, show here too, so you can free their slot. `pixo publish list` shows the same.
- Multiplayer rooms hold up to 20 players instead of 8. Testing two windows on your computer with `pixo rooms test` allows 20 as well.
- **New game** on My games opens the same game setup as the button in the sidebar.
- The AI picks focused design guides (sub-skills) for jobs like level pacing or enemy design, and the chat names them as "skill › sub-skill".
- An art style preset never brings its own look into a game that already has one, and walk and idle animations take the character's look from your picture.
- The Phaser starter game fills a 1280×720 window.
- A new game that has not been planned yet says in its empty chat that planning comes first, and the game area says the game is starting instead of "not running".
- Usage counts you agreed to share are now actually sent; 1.0.7 left them off.
- Fixes: the narrow chat box shows icons instead of one-letter labels, Settings says an AI needs sign-in as the first-run screens do, the first-run model picker names the default in your language, and the app no longer checks the game's run status every 1.5 seconds while nothing runs.

This build is not code signed yet. Windows may show "Unknown publisher" the first time you run the installer; choose **More info**, then **Run anyway**. Windows with Smart App Control turned on will block it.

- 左侧栏工坊后面新增「游戏管理」：你分享出去的游戏都在这里，能看到这个月被玩了多少次、有没有人一起玩。在卡片上可以复制链接、去玩一下或打开游戏；联机每月最多花多少积分、游戏链接和「停止分享」放在「设置」里。项目已经删掉、或在另一台电脑上发布的链接也会显示，方便你停止分享、腾出名额。`pixo publish list` 显示同样的内容。
- 联机房间最多可以 20 人，原来是 8 人。用 `pixo rooms test` 在本机开两个窗口测试时也一样是 20 人。
- 「我的游戏」里的「新建游戏」现在打开和侧栏按钮一样的游戏设置。
- AI 会为关卡节奏、敌人设计这类具体工作挑选更聚焦的设计指南（子技能），对话里显示为「技能 › 子技能」。
- 画风预设不会把自己的画风带进已经定好画风的游戏；行走和待机动画按你的图片里角色的样子来做。
- Phaser 起步游戏按 1280×720 的窗口来画。
- 还没规划的新游戏，空对话里会说明要先规划；游戏区域在启动时显示「正在启动」，不再显示「没有运行」。
- 你同意分享的统计计数现在会真正发送；1.0.7 里它没有打开。
- 修复：窄的输入框显示图标而不是单个字母，设置里和首次使用一样说明 AI 需要登录，首次使用的模型选择用你的语言写默认项，没有游戏在运行时不再每 1.5 秒查询一次运行状态。

这个版本还没有代码签名。第一次运行安装包时，Windows 可能提示“未知发布者”，请点“更多信息”，再点“仍要运行”。开启了智能应用控制（Smart App Control）的 Windows 会直接拦截。

## OpenPixo 1.0.7

- Build each stage of a new game in a fresh conversation: approve the plan with **Approve and start in a new conversation**, or continue the next stage from the line under a stage reply. The new conversation keeps the plan and the project notes and sends far less each turn.
- `/compact` in the chat summarizes a long conversation, so later turns send less.
- Image viewer: zoom with the wheel, Fit and 1:1, sharp pixels above 100%, a pixel grid, the colour under the pointer (click to copy), and the arrow keys step through the images in the folder.
- With credits, the AI says what it is doing while it works, stops after 50 steps in one turn to report where it got to (type "continue" to go on), and runs noticeably faster.
- Routine steps (reading files, searching, running commands) fold into one line that says what they added up to.
- An art style preset is a starting point: once you pick a style reference or describe the look, new images follow you instead of the preset.
- Character turnarounds, icon sets, parallax layers and nine-slice panels come out with a real transparent background, not a painted magenta one.
- Usage data is off until you choose to share it. If you share, OpenPixo sends anonymous counts to its own server; your prompts, conversations, code, images and game files are never sent. PostHog is no longer used.
- Fixes: a chat that kept showing "running" after the run had ended, Godot checks failing on the .NET SDK message, the folder picker without a Documents folder, the approval chip running under the send button, and the daemon running out of memory or stopping itself on Windows under heavy load.

This build is not code signed yet. Windows may show "Unknown publisher" the first time you run the installer; choose **More info**, then **Run anyway**. Windows with Smart App Control turned on will block it.

- 新游戏的每个阶段可以在新对话里做：批准计划时点「批准，并在新对话中开始」，或者在阶段回复下面的那一行继续下一阶段。新对话带着计划和项目笔记，每轮发送的内容少得多。
- 在对话里输入 `/compact` 会把长对话总结成一段，之后每轮发送得更少。
- 图片查看器：滚轮缩放、适合窗口和 1:1、放大后像素保持清晰、像素网格、显示指针下的颜色（点击复制），方向键可以翻看同一文件夹里的图片。
- 用积分时，AI 一边做一边说明在做什么；一轮最多 50 步，到了会停下来说做到哪里（输入“继续”接着做）；速度也明显更快。
- 读文件、搜索、运行命令这类常规步骤会折叠成一行，说明一共做了什么。
- 画风预设只是起点：选了风格参考图或写了画面描述后，新图片按你的要求来，不再套用预设。
- 角色三视图、图标组、视差背景和九宫格面板现在是真正的透明背景，不再是画上去的品红色。
- 统计数据在你同意分享前不会发送。分享后，OpenPixo 只把匿名计数发到自己的服务器；你的提示词、对话、代码、图片和游戏文件都不会发送。不再使用 PostHog。
- 修复：运行已经结束但对话还显示“运行中”、Godot 检查因为 .NET SDK 提示而失败、没有“文档”文件夹时选不了文件夹、批准开关压在发送按钮下面，以及在 Windows 上负载大时 daemon 内存耗尽或把自己停掉。

这个版本还没有代码签名。第一次运行安装包时，Windows 可能提示“未知发布者”，请点“更多信息”，再点“仍要运行”。开启了智能应用控制（Smart App Control）的 Windows 会直接拦截。

## OpenPixo 1.0.6

- 8-direction walk and idle animations: in **Generate**, draw a character's walk sheet (or idle sheet) in all eight directions, check it, then press **8-direction walk animation** (or **8-direction idle animation**) on the result. One short clip animates all eight directions at once, and you get transparent frames and a sprite sheet for your engine, with a looping preview of every direction. Characters with a sword on one side or a bag on the other come out right in every direction. With credits, one animation costs 10 credits.
- Right-click menus: on images, sounds and files the AI made (open, copy, save, attach, show in Explorer), on conversations (rename, fork, mark as unread, delete) and on projects.
- Switching AI mid-conversation, for example from OpenPixo credits to Codex, keeps the plan, gameplay and style you agreed on.
- Long conversations open faster: they show the latest 10 turns, and **Show earlier** brings back more.
- With credits, the AI looks at screenshots and art through a cheaper image reader, so long runs with many screenshots cost less.
- The AI picks the project skills it needs as it works, instead of loading them from words in your message.
- Codex speed is a Regular / Fast switch beside the reasoning setting, and the image model menu matches the other menus.

This build is not code signed yet. Windows may show "Unknown publisher" the first time you run the installer; choose **More info**, then **Run anyway**. Windows with Smart App Control turned on will block it.

- 8 方向行走和待机动画：在「生成」里先画角色的行走姿势图（或待机姿势图），8 个方向都画出来，检查一下，再在结果上点「8 方向行走动画」（或「8 方向待机动画」）。一段短片同时让 8 个方向动起来，得到透明帧和给引擎用的精灵图，每个方向都能循环预览。一边挂剑、另一边背包的角色，每个方向也都画得对。用积分时，一次动画 10 积分。
- 右键菜单：AI 做的图片、声音和文件（打开、复制、保存、作为上下文、在资源管理器中显示），对话（重命名、复制一份、标为未读、删除），以及项目。
- 对话中途换 AI（比如从 OpenPixo 积分换成 Codex）时，之前定好的计划、玩法和画风都会带过去。
- 长对话打开更快：只显示最近 10 轮，点「显示更早」再加载。
- 用积分时，AI 通过更便宜的看图模型看截图和美术，截图多的长任务花得更少。
- AI 在工作中按需选用项目技能，不再根据你消息里的字词自动加载。
- Codex 速度改成推理设置旁边的「常规 / 快速」开关；图片模型菜单和其他菜单样式一致。

这个版本还没有代码签名。第一次运行安装包时，Windows 可能提示“未知发布者”，请点“更多信息”，再点“仍要运行”。开启了智能应用控制（Smart App Control）的 Windows 会直接拦截。

## OpenPixo 1.0.5

- A new game is made with you, one step at a time: gameplay, art style, engine, plan, then one stage at a time. Each step waits for your OK. You pick the look from 2–3 sample images, and after each stage the AI tells you how to try it before going on.
- Auto is the new default credits model: Claude Sonnet 5.5 writes a new game's plan, and DeepSeek V4.1 Flash does everything else. You can still pick a model yourself.
- The AI can now see pictures when it uses DeepSeek V4.1 Flash: your screenshots, its own art and how the game looks while it plays it. Set a style reference image, and the AI uses it when it makes new art.
- Art spending: choose **Ask me first** (the AI lists the art it wants to make and waits) or **Spend within budget**.
- Moving characters get real animation frames, and a set of small images is made together at the price of one. **Check animation frames** and **Align animation frames** fix frames that jump or slide.
- **Generate** has its own place in the left bar, next to the Workshop: make images, sound effects, voice, music and 3D models for any of your games, or before you have one, then save the results into a game. Presets show what they make as pictures, styles are picked from pictures, and recipes can now use your credits at a price you see first. Images come in eight shapes (21:9 included) at 1K, 2K or 4K, up to 8 at a time; a larger size costs a little more.
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
- 「生成」在左侧栏有了自己的位置，就在工坊旁边：为任意一个游戏做图片、音效、配音、音乐和 3D 模型，还没有游戏也能先做，之后再保存到游戏里。预设用图片展示能做出什么，画风也看图挑选；配方现在也能用积分，花多少先告诉你。图片有 8 种比例（含 21:9），可选 1K、2K、4K，一次最多 8 张；尺寸越大积分略多。
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
