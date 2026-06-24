/**
 * Smoke test for maya-kai WebSocket server.
 *
 * Starts src/server.js as a child process on a random free port,
 * connects a WebSocket client, verifies the MSG_INIT handshake message
 * is received, then tears down and exits.
 *
 * Exit 0 = pass, exit 1 = fail.
 */

'use strict';

var net = require('net');
var child_process = require('child_process');
var WebSocket = require('ws');
var path = require('path');

var TIMEOUT_MS = 10000;
var RETRY_INTERVAL_MS = 100;
var serverProcess = null;
var timer = null;

function fail(msg) {
  console.error('FAIL:', msg);
  cleanup(1);
}

function cleanup(code) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  process.exit(code);
}

// Find a free TCP port by binding to :0 then closing.
function getFreePort(cb) {
  var srv = net.createServer();
  srv.listen(0, '127.0.0.1', function () {
    var port = srv.address().port;
    srv.close(function () { cb(port); });
  });
}

// Try to connect a WebSocket, retrying until the server is ready or we time out.
function connectWithRetry(port, retries, cb) {
  if (retries <= 0) {
    return cb(new Error('Server did not become ready in time'));
  }
  var ws = new WebSocket('ws://127.0.0.1:' + port);
  ws.on('open', function () { cb(null, ws); });
  ws.on('error', function () {
    // not ready yet – wait and retry
    setTimeout(function () {
      connectWithRetry(port, retries - 1, cb);
    }, RETRY_INTERVAL_MS);
  });
}

timer = setTimeout(function () {
  fail('Timed out after ' + TIMEOUT_MS + 'ms');
}, TIMEOUT_MS);

getFreePort(function (port) {
  var serverPath = path.resolve(__dirname, '../src/server.js');

  // Launch the server with our free port
  serverProcess = child_process.spawn(process.execPath, [serverPath, '--port', port], {
    stdio: 'ignore',
  });

  serverProcess.on('error', function (err) { fail('Server process error: ' + err.message); });
  serverProcess.on('exit', function (code) {
    if (code !== null && code !== 0) {
      fail('Server exited unexpectedly with code ' + code);
    }
  });

  // Give the OS a tick, then start retrying connections (up to 50 × 100 ms = 5 s)
  setTimeout(function () {
    connectWithRetry(port, 50, function (err, ws) {
      if (err) { return fail(err.message); }
      console.log('OK: WebSocket connection opened on port ' + port);

      ws.on('error', function (e) { fail('WebSocket error after open: ' + e.message); });

      ws.on('message', function (data) {
        var msg;
        try { msg = JSON.parse(data); } catch (e) {
          return fail('Invalid JSON from server: ' + data);
        }
        if (msg.type === 'msg_init' && msg.ID) {
          console.log('OK: Received MSG_INIT handshake, assigned ID:', msg.ID);
          ws.close();
          cleanup(0);
        } else {
          fail('Unexpected message from server: ' + JSON.stringify(msg));
        }
      });
    });
  }, 50);
});
