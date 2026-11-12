# 内置美术风格

语言：[English](README.md) | 简体中文

这 20 种原创 Apache-2.0 美术风格属于纯数据插件。每个目录中的 `pixo.json`
包含正向风格片段、负向片段、调色板、可选约束和本地化示例提示词，
不包含可执行技能。官方商店注册表指向相同目录。

默认建议生成分辨率为 1024 × 1024。像素示例还会指定逻辑精灵尺寸，
生成后需验证原生尺寸，并使用最近邻缩放导出。背景由生成请求或配方负责，
以保留透明精灵和色键精灵表各自的输出约定。3D 预设描述的是资产渲染概念图；
图片预览并非网格模型。

## 风格家族

插件清单没有变体字段，因此家族是一组同级风格：标题使用相同前缀，排序时会排在一起。

| 家族 | 风格 id |
| --- | --- |
| 复古像素 | `pixel-16-bit`（默认）、`pixel-8-bit`（每个精灵四色，示例包含严格的双色 1 位模式）、`isometric-pixel` |
| 3D 中的像素 | `sprite-diorama` |
| 2D 插画 | `painted-fantasy`、`painted-cutout`、`cel-anime`、`chibi-cute`、`cozy-pastel`、`flat-vector`、`ink-woodcut`、`watercolor-storybook`、`dark-gothic` |
| 类型可读性 | `horde-topdown`、`crt-card-table`、`vaporwave-crt` |
| 3D | `low-poly-3d`、`retro-low-poly`、`toon-3d`、`voxel-3d` |

`sprite-diorama`、`horde-topdown` 和 `crt-card-table` 有意不使用 `pixel`
介质标记：配方后处理会把像素介质视为像素化和调色板量化请求，
这会抹平它们的泛光、景深和屏幕辉光。

原 `monochrome-1-bit` 风格已并入 `pixel-8-bit`。仍引用该 id 的项目会在元数据中保留它，
在用户选择其他风格之前解析为无风格。

## 封面

每种风格都附带 `previews/cover.webp`，并登记为
`"previews": ["previews/cover.webp"]`。封面旁的 `previews/PROMPT.md`
记录生成提示词和导出说明。封面规则：

- WebP，sRGB，不透明，1200 × 900 像素，横向 4:3。
- 展示一个原创游戏美术主体，周围留出适合缩略图裁切的空间。
  焦点主体放在画面中央 80% 的区域内。
- 遵循对应清单的调色板、正向片段和负向片段。背景应适合样例；
  不要烘焙标题、说明文字、标志、水印、第三方角色或对特定艺术家的模仿。
- 像素风格保持统一逻辑像素网格，使用最近邻采样放大。
  不要为凑够封面尺寸而模糊像素边缘。
- 可选第二张样例使用 `previews/detail.webp`，同样为 1200 × 900、4:3，
  作为 `previews` 的第二项登记。路径相对于风格目录，第一张图用于商店封面。

文件存在后才能登记路径。

| 风格 id | 封面文件 |
| --- | --- |
| `pixel-16-bit` | `pixel-16-bit/previews/cover.webp` |
| `pixel-8-bit` | `pixel-8-bit/previews/cover.webp` |
| `isometric-pixel` | `isometric-pixel/previews/cover.webp` |
| `sprite-diorama` | `sprite-diorama/previews/cover.webp` |
| `painted-fantasy` | `painted-fantasy/previews/cover.webp` |
| `painted-cutout` | `painted-cutout/previews/cover.webp` |
| `cel-anime` | `cel-anime/previews/cover.webp` |
| `chibi-cute` | `chibi-cute/previews/cover.webp` |
| `cozy-pastel` | `cozy-pastel/previews/cover.webp` |
| `flat-vector` | `flat-vector/previews/cover.webp` |
| `ink-woodcut` | `ink-woodcut/previews/cover.webp` |
| `watercolor-storybook` | `watercolor-storybook/previews/cover.webp` |
| `dark-gothic` | `dark-gothic/previews/cover.webp` |
| `horde-topdown` | `horde-topdown/previews/cover.webp` |
| `crt-card-table` | `crt-card-table/previews/cover.webp` |
| `vaporwave-crt` | `vaporwave-crt/previews/cover.webp` |
| `low-poly-3d` | `low-poly-3d/previews/cover.webp` |
| `retro-low-poly` | `retro-low-poly/previews/cover.webp` |
| `toon-3d` | `toon-3d/previews/cover.webp` |
| `voxel-3d` | `voxel-3d/previews/cover.webp` |

封面完整路径为本目录加上表中的文件路径。
登记清单和测试图库不需要调用模型或提供商。
