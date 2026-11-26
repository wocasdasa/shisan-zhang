// 极简 WebSocket 客户端（Node 侧测试用），无第三方依赖
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function mask(payload) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const key = crypto.randomBytes(4);
  let head;
  if (data.length < 126) {
    head = Buffer.from([0x81, 0x80 | data.length]);
  } else if (data.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 0x80 | 126;
    head.writeUInt16BE(data.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 0x80 | 127;
    head.writeUInt32BE(0, 2);
    head.writeUInt32BE(data.length, 6);
  }
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ key[i % 4];
  return Buffer.concat([head, key, masked]);
}

class Client extends EventEmitter {
  constructor(url) {
    super();
    const m = /ws:\/\/([^:/]+):(\d+)(\/[^\s]*)?/.exec(url);
    const host = m ? m[1] : '127.0.0.1';
    const port = m ? Number(m[2]) : 8787;
    const path = (m && m[3]) || '/';
    const key = crypto.randomBytes(16).toString('base64');
    this.buf = Buffer.alloc(0);
    const req = http.request({
      host, port, path, headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13'
      }
    });
    req.on('upgrade', (res, socket) => {
      this.socket = socket;
      socket.on('data', (chunk) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        this.drain();
      });
      socket.on('close', () => this.emit('close'));
      socket.on('error', (e) => this.emit('error', e));
      this.emit('open');
    });
    req.on('error', (e) => this.emit('error', e));
    req.end();
  }

  drain() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      let len = b1 & 0x7f, offset = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2); offset = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2)); offset = 10;
      }
      if (this.buf.length < offset + len) return;
      const payload = this.buf.slice(offset, offset + len);
      this.buf = this.buf.slice(offset + len);
      if ((b0 & 0x0f) === 0x1) {
        let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
        this.emit('message', msg);
      }
    }
  }

  send(obj) { if (this.socket) this.socket.write(mask(obj)); }
  close() { if (this.socket) this.socket.end(); }
}

module.exports = Client;
