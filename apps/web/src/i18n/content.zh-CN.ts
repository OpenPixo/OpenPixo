import type { PromptTemplateSummary } from '../types';

export const ZH_CN_SKILL_COPY: Record<string, { description?: string; examplePrompt?: string }> = {
  'agent-browser': {
    description:
      '面向 AI agent 的浏览器自动化 CLI。当用户需要检查、\n测试或自动化浏览器行为时使用：导航页面、填写表单、\n点击按钮、截图、提取页面数据、读取选中的\nOpenPixo 浏览器标签页上下文、测试 web 应用、试用 OpenPixo\n预览、QA、缺陷排查或评审应用质量。除非用户明确要求外部浏览，\n否则优先使用本地 OpenPixo 预览 URL。',
    examplePrompt:
      '面向 AI agent 的浏览器自动化 CLI。',
  },
};

export const ZH_CN_PROMPT_TEMPLATE_CATEGORIES: Record<string, string> = {
  'Advertising': '广告',
  'Anime': '动漫',
  'Anime / Manga': '动漫 / 漫画',
  'App / Web Design': '应用 / 网页设计',
  'Branding': '品牌塑造',
  'Cinematic': '电影感',
  'Concept Art': '概念设定',
  'Data': '数据',
  'Game Assets': '游戏素材',
  'Game UI': '游戏 UI',
  'General': '通用',
  'Illustration': '插画',
  'Infographic': '信息图',
  'Live Artifact': '实时看板',
  'Marketing': '营销',
  'Motion Graphics': '动态图形',
  'Product': '产品',
  'Profile / Avatar': '头像 / 形象',
  'Short Form': '短视频',
  'Social / Meme': '社交 / 表情包',
  'Social Media Post': '社交媒体帖子',
  'Travel': '旅行',
  'VFX / Fantasy': '视觉特效 / 奇幻',
  'VFX / HTML-in-Canvas': '视觉特效 / HTML-in-Canvas',
};

export const ZH_CN_PROMPT_TEMPLATE_TAGS: Record<string, string> = {
  '3d': '3d',
  '3d-render': '3d 渲染',
  'action': '动作',
  'anime': '动漫',
  'app-showcase': '应用展示',
  'archery': '射箭',
  'arpg': 'arpg',
  'audio-reactive': '音频响应',
  'boss-fight': 'Boss 战',
  'brand': '品牌',
  'branding': '品牌塑造',
  'captions': '字幕',
  'cavalry': '骑兵',
  'chart': '图表',
  'childlike': '童趣',
  'choreography': '编舞',
  'cinematic': '电影感',
  'cinematic-romance': '电影感浪漫',
  'combat': '战斗',
  'combo': '连招',
  'companion-to-image': '配图生成',
  'counter': '反击',
  'crayon': '蜡笔',
  'cyberpunk': '赛博朋克',
  'dance': '舞蹈',
  'dashboard': '仪表盘',
  'data': '数据',
  'data-viz': '数据可视化',
  'destruction': '破坏',
  'displacement': '置换',
  'editorial': '编辑排版',
  'elden-ring': 'elden-ring',
  'endcard': '结尾卡片',
  'escort': '护送',
  'escort-mission': '护送任务',
  'fantasy': '奇幻',
  'fashion': '时尚',
  'fighting-game': '格斗游戏',
  'food': '美食',
  'game-cinematic': '游戏过场动画',
  'game-ui': '游戏 UI',
  'grid-sheet': '网格表',
  'guanyu': '关羽',
  'hand-drawn': '手绘',
  'hero': '主视觉',
  'html-in-canvas': '画布内 HTML',
  'hud': 'HUD',
  'hud-safe': 'HUD 安全区',
  'hype': '造势',
  'hyperframes': 'HyperFrames',
  'idol': '偶像',
  'illustration': '插画',
  'image-to-image': '图生图',
  'infographic': '信息图',
  'iphone': 'iphone',
  'japanese': '日式',
  'karaoke': '卡拉OK',
  'key-visual': '主视觉',
  'keynote': '主题演讲',
  'kinetic-typography': '动态文字',
  'linear-style': 'Linear 风格',
  'liquid': '流体',
  'liquid-glass': '液态玻璃',
  'live-artifact': '实时作品',
  'logo': '标志',
  'lyubu': '吕布',
  'macbook': 'macbook',
  'magnetic': '磁吸',
  'map': '地图',
  'marketing': '营销',
  'minimal': '极简',
  'mmo': 'mmo',
  'mobile': '移动端',
  'money': '金钱',
  'mounted-combat': '骑乘战斗',
  'nature': '自然',
  'open-world': '开放世界',
  'otaku-dance': '宅舞',
  'outro': '片尾',
  'overlay': '叠加层',
  'particles': '粒子',
  'pipeline': '流水线',
  'portal': '传送门',
  'portrait': '肖像',
  'pose-reference': '姿势参考',
  'product': '产品',
  'product-demo': '产品演示',
  'product-promo': '产品宣传',
  'rework': '返工',
  'route': '路线',
  'saas': 'saas',
  'sequence': '序列',
  'shader': '着色器',
  'shatter': '碎裂',
  'sizzle': '短片',
  'social': '社交',
  'storyboard': '故事板',
  'style-transfer': '风格迁移',
  'text': '文本',
  'tiktok': 'tiktok',
  'title-card': '标题卡',
  'transform': '变换',
  'travel': '旅行',
  'tts': 'tts',
  'typography': '排版',
  'unreal-engine-5': 'unreal-engine-5',
  'vertical': '竖屏',
  'video-reference': '视频参考',
  'vs-screen': '对战画面',
  'webgl': 'webgl',
  'website-to-video': '网站转视频',
};

export const ZH_CN_PROMPT_TEMPLATE_COPY: Record<string, Partial<Pick<PromptTemplateSummary, 'summary' | 'title'>>> = {
  'cozy-farming-sim-scene': {
    title: '治愈系农场模拟场景',
    summary:
      '为治愈系生活模拟游戏生成温暖的俯视像素农场场景：已开垦的作物田、农舍、动物、蜿蜒小路和小小的玩家角色，基于统一的瓦片网格并带有柔和的季节光照。可调整季节、时段、作物和建筑。',
  },
  'deckbuilder-card-face-and-frame': {
    title: '卡牌构筑游戏卡面与卡框',
    summary:
      '为卡牌肉鸽 / 卡牌构筑游戏生成单张卡牌：费用宝石、名称横幅、带框插画、类型行、规则文字框与稀有度点缀，排版保证在手牌尺寸下插画和卡框颜色依然可读。可填写卡名、类型、费用、规则文字、插画主体和卡框风格。',
  },
  'dialogue-portrait-expression-sheet': {
    title: '对话立绘表情差分表',
    summary:
      '生成同一角色的 3x3 对话立绘表情差分表：平静、开心、大笑、难过、生气、惊讶、害羞、坚定和害怕，所有格子取景、视线高度与服装完全一致，背景为纯色，可在对话框中无缝切换。可调整角色、画风与表情列表。',
  },
  'item-ability-icon-sheet': {
    title: '道具与技能图标表',
    summary:
      '生成风格统一的游戏道具或技能图标网格表：每格一个主体、纯色背景便于切图，剪影各不相同，光照方向与描边粗细一致，缩到 32–64 像素依然可读。可调整主题、图标清单、风格与背景色。',
  },
  'metroidvania-biome-environment-concept': {
    title: '类银河恶魔城生物群系场景概念',
    summary:
      '为类银河恶魔城（metroidvania）的一个生物群系生成横版场景概念，内置可读的移动设计：清晰的可站立平台、需要后期能力才能通过的封锁路径、多层视差纵深和一个视觉焦点地标。可调整群系、封锁能力、地标和配色。',
  },
  'pixel-sprite-3d-diorama': {
    title: '像素精灵 3D 立体场景（移轴 2.5D）',
    summary:
      '生成 2.5D 立体场景：清晰的像素角色精灵置于有光影的低细节 3D 环境中，配合移轴景深、泛光和体积光，正是当代复古风 RPG 流行的画面风格。可调整地点、队伍、时段与配色。',
  },
  'retro-low-poly-horror-scene': {
    title: '复古 32 位低多边形恐怖场景',
    summary:
      '生成一帧上世纪 90 年代末主机风格的氛围恐怖画面：低多边形几何体、未过滤且扭曲的低分辨率贴图、浓重的距离雾、抖动色彩和 320x240 质感，配合单一光源与令人不安的威胁暗示。可调整地点、光源和威胁。',
  },
  'roguelite-reward-choice-ui-mock': {
    title: '肉鸽游戏奖励三选一界面样机',
    summary:
      '生成经典肉鸽奖励界面的全屏 UI 样机：三张带图标、稀有度颜色和简短效果说明的升级卡，叠加在变暗的游戏画面上，并含重抽 / 跳过按钮、货币、局内进度和常驻 HUD。可调整主题、UI 风格和三项升级内容。',
  },
  'steam-capsule-key-art': {
    title: 'Steam 胶囊图主视觉（无文字母版）',
    summary:
      '为 Steam 商店胶囊图生成无文字的主视觉母版：一张画即可干净裁切为页眉胶囊（460x215，上传 920x430）、主胶囊（616x353，上传 1232x706）、小胶囊（231x87，上传 462x174）和库胶囊（600x900）。预留平静的 Logo 区、单一清晰的主体剪影和强明暗对比，缩成小缩略图依然可读；Logo 之后再合成。',
  },
  'store-screenshot-gameplay-moment': {
    title: '商店截图 - 精心摆拍的游戏瞬间',
    summary:
      '为商店页或媒体资料包生成一张 16:9 的摆拍游戏截图，突出一个具体的游玩瞬间：玩家角色清晰、威胁与应对一目了然、HUD 简洁可读并带有成长暗示，构图在商店轮播小缩略图中依然清楚。',
  },
  'survivors-like-horde-gameplay-mock': {
    title: '割草类（幸存者like）尸潮玩法样机',
    summary:
      '为割草类 / 弹幕天堂（bullet heaven）游戏生成局中玩法样机：孤身主角站在清晰的空圈中，被数百敌人包围，环绕的自动攻击武器、经验宝石以及该类型标准 HUD（计时器、经验条、武器栏）。重点保证混乱画面中玩家依然清晰可辨。',
  },
  'toon-shaded-character-turnaround': {
    title: '卡通渲染 3D 角色三视图',
    summary:
      '为卡通渲染（toon-shaded）3D 游戏生成可直接用于建模的角色设定图：正面、四分之三侧面与背面三视图，放松的 A 字姿势，赛璐璐着色、干净描边、比例一致，并附配色色板。可调整角色、职业定位、剪影母题和配色。',
  },
  'boss-reveal-cinematic': {
    title: 'Boss 登场演出',
    summary:
      '一段 10 秒的引擎内风格 Boss 登场演出：竞技场安静下来，Boss 以剪影现身，展示招牌动作并咆哮，随后镜头回到游戏视角，Boss 血条与名牌滑入。可作为预告片高潮或玩法参考。',
  },
  'character-roster-reveal': {
    title: '角色阵容登场展示',
    summary:
      '一段 10–12 秒的英雄阵容展示，适用于预告片或公告：每个可玩角色依次登场，摆出招牌姿势并闪现技能，最后全部归位成阵容定格。可基于文字描述或附带的角色参考图生成。',
  },
  'devlog-intro-bumper': {
    title: '开发日志片头',
    summary:
      '为 YouTube 或 B 站开发日志系列生成一段 4–6 秒的片头：从开发者工作台快速、亲切地过渡到游戏世界，结尾停在稳定画面并留出干净的下三分之一区域放置每期标题。可在每期视频开头重复使用。',
  },
  'gameplay-trailer-30s-beat-sheet': {
    title: '游戏预告片 - 30 秒节拍表',
    summary:
      '把 30 秒的独立游戏实机预告规划为六个镜头：开场钩子、核心循环、内容多样性、升级爽感、高潮，以及留给 Logo 和「加入愿望单」号召的干净结尾画面。每个镜头在统一风格锁定下单独生成短片段，再在剪辑软件中按音乐剪辑。',
  },
  'logo-sting-title-reveal': {
    title: 'Logo 片头 - 游戏标题揭幕',
    summary:
      '一段 5–6 秒的 Logo 片头，可用于预告片、开发日志和游戏启动画面：来自游戏世界的元素逐步汇聚成标题揭幕，并以较长的稳定画面结束。可提供 Logo 图片作为参考（原样还原、绝不重绘），也可留出干净的标题区稍后合成 Logo。',
  },
  'steam-next-fest-demo-teaser': {
    title: 'Steam 新品节试玩版预告（15 秒）',
    summary:
      '一段 15 秒的预告，告诉逛新品节的玩家「有可玩的试玩版」：两秒的玩法钩子、快速展示试玩版内容、暗示试玩版之后还有什么的悬念，以及留给「立即试玩」文字的干净结尾。专为商店页静音自动播放设计。',
  },
  'vertical-juicy-gameplay-clip': {
    title: '竖屏社媒短片 - 爽感十足的游戏瞬间',
    summary:
      '为短视频平台生成一段可循环的 9:16 竖屏片段，展示一个爽感十足的游戏瞬间：顿帧、屏幕震动、粒子、醒目的伤害数字与连击收尾，画面构图位于安全区内，不会被平台按钮和字幕遮挡。',
  },
};
