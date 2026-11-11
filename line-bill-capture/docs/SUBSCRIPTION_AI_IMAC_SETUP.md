# ติดตั้งตัวอ่านบิลด้วย AI แบบ subscription บน iMac

ระบบ LINE Bill Capture ให้ iMac อ่านรูปบิลและสลิปแทนการเรียก API ที่คิดเงินตาม token ได้
iMac จะใช้ **Claude Code** (บัญชี Claude Pro/Max) หรือ **Codex** (บัญชี ChatGPT Plus/Pro) ที่ล็อกอินไว้
แล้วส่งผลกลับให้ระบบจับคู่บิลกับสลิปตามเดิม

- iMac ทำงานแบบดึงงาน คือไปถามเซิร์ฟเวอร์ทุก 10 นาทีว่ามีรูปใหม่ไหม ถ้ามีก็อ่านทีละใบ จึงไม่ต้องเปิดพอร์ตหรือตั้งค่าเราเตอร์
- ไม่มี API เสียเงินสำรอง (เจ้าของเลือกไว้) ถ้า iMac ปิดอยู่หรือโควตา subscription หมด รูปจะรอในคิว เมื่อ iMac กลับมาก็จะอ่านต่อเอง
- รูปที่ดาวน์โหลดมาอ่านจะถูกลบทันทีหลังอ่านเสร็จ เก็บไว้เฉพาะบันทึกสั้น ๆ ว่าอ่านใบไหนได้ผลอะไร

---

## ส่วนที่ 1 — ฝั่งเซิร์ฟเวอร์ (ทำตอนปล่อยขึ้น Production)

ส่วนนี้ Claude ทำให้ตอนปล่อยงานแบบ controlled release ตาม AGENTS.md §2 หลังเจ้าของอนุมัติ

1. สร้าง token สุ่ม (เก็บเป็นความลับ ห้ามใส่ใน git หรือแชท):
   ```bash
   openssl rand -hex 32
   ```
2. ตั้ง Railway Variables ของ service `line-bill-capture`:
   - `AI_PROVIDER=external`
   - `AI_EXTERNAL_RUNNER_TOKEN=<token จากข้อ 1>`
3. ถ้าต้องการกลับไปใช้ Claude API แบบเดิม ให้เปลี่ยน `AI_PROVIDER=anthropic` ได้ทันที (คีย์เดิมยังอยู่)

---

## ส่วนที่ 2 — เตรียม iMac (ทำครั้งเดียว)

### 2.1 ตั้งค่าไม่ให้เครื่องหลับ

ตัวอ่านทำงานเฉพาะตอนที่ผู้ใช้ล็อกอินค้างไว้บน iMac และเครื่องไม่หลับ

- System Settings → Energy (หรือ Battery/Energy Saver) → เปิด **Prevent automatic sleeping when the display is off**
- อย่าออกจากระบบ (Log Out) ล็อกหน้าจอได้ตามปกติ

### 2.2 ติดตั้ง Node.js 20 ขึ้นไป

เปิด Terminal แล้วตรวจ:
```bash
node -v
```
ถ้ายังไม่มีหรือต่ำกว่า v20 ให้ติดตั้งด้วย Homebrew:
```bash
brew install node
```

### 2.3 ติดตั้งและล็อกอิน AI (เลือกตัวใดตัวหนึ่ง หรือทั้งสองตัว)

**Claude Code (บัญชี Claude Pro/Max)**
```bash
curl -fsSL https://claude.ai/install.sh | bash
```
```bash
claude
```
ในหน้าจอ Claude พิมพ์ `/login` → เลือก **Claude account with subscription** → ล็อกอินในเบราว์เซอร์ → พิมพ์ `/exit`

**Codex (บัญชี ChatGPT)**
```bash
brew install codex
```
```bash
codex login
```
เลือก **Sign in with ChatGPT** แล้วตรวจว่า:
```bash
codex login status
```
ต้องขึ้นว่า `Logged in using ChatGPT` (ถ้าขึ้นว่าใช้ API key แปลว่ายังเป็นแบบเสียเงิน ให้ล็อกอินใหม่)

> ห้ามตั้ง `ANTHROPIC_API_KEY` หรือ `OPENAI_API_KEY` ไว้ใน `~/.zshrc` ของ iMac ตัวอ่านจะตัดตัวแปรพวกนี้ทิ้งให้อยู่แล้ว แต่ไม่ควรมีตั้งแต่ต้น

### 2.4 คัดลอกสคริปต์มาไว้บน iMac

สคริปต์เป็นไฟล์เดียว `scripts/subscription-ai-runner.mjs` ไม่ต้องติดตั้ง npm

```bash
mkdir -p ~/lbc-ai-runner
```
จากนั้นคัดลอกไฟล์มาวางที่ `~/lbc-ai-runner/subscription-ai-runner.mjs` ด้วยวิธีใดก็ได้ เช่น AirDrop จาก MacBook
หรือดึงจาก GitHub (ถ้า iMac มีสิทธิ์เข้า repo):
```bash
git clone --depth 1 -b claude/lbc-subscription-ai https://github.com/namo1997/market-order-app.git ~/lbc-ai-runner/repo && cp ~/lbc-ai-runner/repo/line-bill-capture/scripts/subscription-ai-runner.mjs ~/lbc-ai-runner/
```
(เมื่อรวมงานเข้า branch หลักแล้ว ให้เปลี่ยน `-b` เป็น branch นั้น)

### 2.5 ใส่ token

คัดลอก token จากส่วนที่ 1 ไว้ใน clipboard แล้วรัน:
```bash
mkdir -p ~/.config/lbc-ai-runner && pbpaste > ~/.config/lbc-ai-runner/token && chmod 600 ~/.config/lbc-ai-runner/token
```

### 2.6 เลือกที่เก็บงานชั่วคราว

ค่าเริ่มต้นคือ SSD `/Volumes/SSD Files/SOLAO/line-bill-capture/subscription-runner` ตามกติกา SSD ของ SOLAO
ถ้า SSD ไม่ได้เสียบอยู่ ตัวอ่านจะ **หยุด** ไม่สร้างโฟลเดอร์แทนบนดิสก์ภายในเอง
ถ้า iMac ไม่มี SSD ตัวนี้ ให้เจ้าของเลือกโฟลเดอร์เอง แล้วใส่ `--work-dir <โฟลเดอร์>` ในทุกคำสั่งด้านล่าง

---

## ส่วนที่ 3 — ตรวจความพร้อมและเปิดใช้

แทน `https://<โดเมน line-bill-capture>` ด้วยที่อยู่เว็บระบบจริง (หน้าเดียวกับที่เปิด `/admin`)
และเลือก `--agent claude` หรือ `--agent codex`

### 3.1 ตรวจความพร้อม
```bash
node ~/lbc-ai-runner/subscription-ai-runner.mjs doctor --server https://<โดเมน line-bill-capture> --agent codex
```
ต้องขึ้น ✅ ทุกข้อ (Node, ที่เก็บงาน, token, เชื่อมเซิร์ฟเวอร์แบบ external, AI ล็อกอินแล้ว)
ถ้าเป็น `--agent claude` ระบบจะถาม Claude หนึ่งคำสั้น ๆ เพื่อยืนยันการล็อกอิน (ใช้โควตา subscription เล็กน้อย)

### 3.2 ลองอ่าน 1 ใบ
```bash
node ~/lbc-ai-runner/subscription-ai-runner.mjs run --server https://<โดเมน line-bill-capture> --agent codex --max 1
```
ควรเห็น `อ่านแล้ว #<เลข> → bill <ยอด>` (ถ้าคิวว่างจะขึ้น `อ่านสำเร็จ 0`) แล้วเปิดหน้า `/admin` ดูว่ารูปนั้นอ่านถูก

### 3.3 ตั้งให้รันเองทุก 10 นาที
```bash
node ~/lbc-ai-runner/subscription-ai-runner.mjs install-launchd --server https://<โดเมน line-bill-capture> --agent codex --interval 600 --load
```
คำสั่งนี้สร้าง `~/Library/LaunchAgents/com.solao.lbc-subscription-ai-runner.plist`
และเริ่มรอบแรกทันที ต่อจากนั้น macOS จะเรียกเองทุก 10 นาที (ถ้ารอบก่อนยังไม่จบ รอบใหม่จะข้ามไปเอง)
แต่ละรอบอ่านได้สูงสุด 30 ใบ (ปรับด้วย `--max`)

---

## การใช้งานประจำวัน

| อยากทำ | คำสั่ง |
|---|---|
| ดูคิวรูปที่รออ่าน | `node ~/lbc-ai-runner/subscription-ai-runner.mjs status --server https://<โดเมน>` |
| ดูบันทึกวันนี้ | `tail -50 "<ที่เก็บงาน>/logs/$(date -u +%F).log"` |
| สั่งอ่านทันทีไม่รอรอบ | `launchctl kickstart gui/$(id -u)/com.solao.lbc-subscription-ai-runner` |
| เปลี่ยนจาก Codex เป็น Claude | รัน `install-launchd ... --agent claude --load` ซ้ำ (จะแทนที่ของเดิม) |
| หยุดตั้งเวลา | `node ~/lbc-ai-runner/subscription-ai-runner.mjs uninstall-launchd` |

## เมื่อมีปัญหา

| อาการในบันทึก | สาเหตุ / วิธีแก้ |
|---|---|
| `หยุดรอบนี้ คืนรูป ... usage limit` | โควตา subscription หมด รูปกลับเข้าคิวโดยไม่เสียสิทธิ์ลองใหม่ รอโควตารีเซ็ตแล้วรอบถัดไปจะอ่านต่อเอง |
| `... Please run /login` หรือ `not logged in` | ล็อกอินหลุด ทำข้อ 2.3 ใหม่ |
| `ไม่พบไดรฟ์ /Volumes/...` | SSD ไม่ได้เสียบ เสียบ SSD หรือใช้ `--work-dir` ตามข้อ 2.6 |
| `PROVIDER_NOT_EXTERNAL` | เซิร์ฟเวอร์ยังใช้ API อยู่ ต้องตั้ง `AI_PROVIDER=external` (ส่วนที่ 1) |
| `INVALID_RUNNER_TOKEN` | token บน iMac ไม่ตรงกับ Railway ทำข้อ 2.5 ใหม่ |
| `อ่านไม่สำเร็จ #... (จะลองใหม่ภายหลัง)` | AI ตอบผิดรูปแบบหรือช้าเกิน 5 นาที ระบบจะให้ลองใหม่เอง (สูงสุด 8 ครั้ง) |
| รูปค้างไม่ขยับ ทั้งที่ iMac เปิดอยู่ | ตรวจว่ายังล็อกอินผู้ใช้อยู่และเครื่องไม่หลับ แล้วรัน `doctor` |

## ความปลอดภัย

- token มีสิทธิ์แค่จองรูปในคิว ดาวน์โหลดรูปที่จองไว้ และส่งผลอ่านกลับ ไม่เปิดหน้าแอดมินและไม่ยืนยันคู่แทนคน
- ทุกคู่ที่ AI เสนอยังต้องรอคนยืนยันเหมือนเดิม
- Claude ถูกจำกัดให้ใช้แค่เครื่องมืออ่านไฟล์ในโฟลเดอร์ของรูปนั้น ส่วน Codex รันแบบ read-only sandbox
