# Notification audio fixture

`notification-long.flac` contains 60 seconds of synthetic silence at 8 kHz, mono.
It is small enough to pass the encoded-byte limit but must be rejected before
Web Audio allocates a fully decoded buffer.

Regenerate from the repository root with FFmpeg:

```sh
ffmpeg -f lavfi -i anullsrc=channel_layout=mono:sample_rate=8000 -t 60 -c:a flac -metadata_header_padding 0 e2e/fixtures/notification-long.flac
```
