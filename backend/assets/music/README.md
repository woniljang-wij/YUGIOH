# 🎵 Thư mục nhạc – YUGIOH

Thư mục này dùng để chứa **nhạc nền (BGM)** và **hiệu ứng âm thanh (SFX)** của game.
Các file nhạc nền và hiệu ứng âm thanh của game được đặt trong các thư mục bên dưới.

## Cấu trúc

```
assets/music/
├── bgm/     ← nhạc nền (nhạc nền sảnh, nhạc nền trận đấu...)
├── sfx/     ← hiệu ứng (click, rút bài, triệu hồi, tấn công...)
└── README.md
```

## Tên file gợi ý (đặt đúng tên là code tự nhận, không cần sửa gì)

| File | Dùng cho |
|---|---|
| `bgm/lobby.mp3` | Nhạc nền sảnh chính |
| `bgm/lobby-alt.mp3` | Bài sảnh thứ hai; thứ tự phát được chọn ngẫu nhiên một lần khi vào sảnh |
| `bgm/duel.mp3` | Nhạc nền khi vào bàn đấu |
| `sfx/click.mp3` | Tiếng bấm nút trên mọi trang trừ bàn đấu |
| `sfx/draw.mp3` | Tiếng rút bài |
| `sfx/summon.mp3` | Tiếng triệu hồi quái thú |
| `sfx/win.mp3` | Tiếng thắng trận |

> Bạn có thể dùng `.mp3`, `.ogg` hoặc `.wav` — chỉ cần đổi lại đuôi trong code.

## Cách thêm nhạc

1. Copy file nhạc vào `backend/assets/music/bgm/` (hoặc `backend/assets/music/sfx/`).
2. Đặt tên theo bảng trên (ví dụ `lobby.mp3`).
3. Nhạc sảnh bắt đầu với một trong hai bài được chọn ngẫu nhiên, sau đó luân phiên theo thứ tự và lặp lại.
4. Hiệu ứng `click.mp3` được phát khi nhấn nút trên trang đăng nhập, màn bắt đầu và sảnh.

## Lưu ý

- **Định dạng khuyến nghị:** `.mp3` (bitrate 128–192 kbps) cho nhạc nền, `.ogg`/`.mp3` cho SFX.
- **Dung lượng:** nên giữ mỗi file BGM dưới ~8 MB để web tải nhanh.
- **Bản quyền:** dùng nhạc bạn có quyền sử dụng (nhạc tự làm, nhạc miễn phí bản quyền...) để tránh rắc rối khi bảo vệ đồ án.
- Trình duyệt có thể chặn tự động phát nhạc cho tới khi người dùng tương tác với trang — đây là quy tắc chung, không phải lỗi code.
