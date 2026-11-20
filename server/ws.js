// 极简 WebSocket 服务端（RFC6455 文本帧），不依赖第三方包
// 只处理：握手、文本帧、关闭、ping/pong。够本项目的联机用。
const crypto = require('crypto');
const http = require('http');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  let head;
  if (data.length < 126) {
    head = Buffer.from([0x80 | opcode, data.length]);
  } else if (data.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(data.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeUInt32BE(0, 2);
    head.writeUInt32BE(data.length, 6);
  }
  return Buffer.concat([head, data]);
}

class Conn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.alive = true;
    this.buf = Buffer.alloc(0);
    this.id = crypto.randomBytes(4).toString('hex');

    socket.on('data', (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.drain();
    });
    socket.on('close', () => { this.alive = false; this.emit('close'); });
    socket.on('error', () => { this.alive = false; this.emit('close'); });
  }

  drain() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        offset = 10;
      }
      let maskKey = null;
      if (masked) {
        if (this.buf.length < offset + 4) return;
        maskKey = this.buf.slice(offset, offset + 4);
        offset += 4;
      }
      if (this.buf.length < offset + len) return;
      const payloadRaw = this.buf.slice(offset, offset + len);
      this.buf = this.buf.slice(offset + len);

      let payload = payloadRaw;
      if (maskKey) {
        payload = Buffer.alloc(len);
        for (let i = 0; i < len; i++) payload[i] = payloadRaw[i] ^ maskKey[i % 4];
      }

      if (opcode === 0x1) {
        if (!fin) continue; // 本项目不用分片
        let text = payload.toString('utf8');
        let msg;
        try { msg = JSON.parse(text); } catch (e) { continue; }
        this.emit('message', msg);
      } else if (opcode === 0x8) {
        this.close();
      } else if (opcode === 0x9) {
        this.socket.write(encodeFrame(0xA, payload));
      }
    }
  }

  send(obj) {
    if (!this.alive) return;
    try { this.socket.write(encodeFrame(0x1, JSON.stringify(obj))); } catch (e) { /* ignore */ }
  }

  close() {
    if (!this.alive) return;
    this.alive = false;
    try { this.socket.write(encodeFrame(0x8, Buffer.alloc(0))); } catch (e) {}
    try { this.socket.end(); } catch (e) {}
    this.emit('close');
  }
}

function createServer(port, onConn) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('guangxi13 relay server is running');
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    const conn = new Conn(socket);
    if (onConn) onConn(conn, req);
  });

  server.listen(port, '0.0.0.0');
  return server;
}

module.exports = { createServer };
