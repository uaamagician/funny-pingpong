# 乒乓大亂鬥（暫名）

手機直式乒乓球遊戲：用手指滑動殺球、旋球、吊球、切球，搞笑抽象的 3D 角色。
參考對象：[matdrive.app](https://matdrive.app)。

## 執行

```bash
npm install
npm run dev      # 開發（同網段手機可直接開 Network 網址）
npm run build    # 產生 dist/
```

## 操作

| 動作 | 手勢 |
|---|---|
| 發球 | 向上滑，左右決定方向 |
| 擊球 | 球彈起後往前滑，時機越準越準確 |
| 殺球 | 球在高處時快速猛滑 |
| 旋球 | 滑動時劃出弧線（左弧／右弧） |
| 吊球 | 輕輕短滑 |
| 切球 | 向下滑 |

桌機測試：空白鍵 = 一般擊球。

## 結構

- `src/physics.js` 球的物理與擊球解算（旋轉、過網補償）
- `src/character.js` 程式生成的搞笑角色（外觀全由一份 config JSON 決定）
- `src/main.js` 場景、規則、手勢、AI、主迴圈
- `src/audio.js` WebAudio 合成音效

## 路線圖

1. [x] 單人對 AI 原型（手勢、旋轉、計分）
2. [ ] 角色編輯器（臉型、五官、服飾滑桿，存成 JSON）
3. [ ] Google 登入（Firebase Auth）與背包存檔
4. [ ] 寶箱／球拍／造型收集（機率由伺服器決定）
5. [ ] 連線對戰（伺服器權威物理，例如 Colyseus）
6. [ ] Capacitor 包成 iOS／Android App
