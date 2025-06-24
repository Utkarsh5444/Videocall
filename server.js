const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let queue = []; // Array of { socketId, patientId }
let doctorSocket = null;
let durations = []; // call durations in minutes
let patientStartTimes = {};
let currentCallPatientId = null;

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-queue', (patientId) => {
    queue.push({ socketId: socket.id, patientId });
    console.log(`Patient ${patientId} joined the queue`);
    sendQueueUpdates(); // update wait time for all
  });

  socket.on('register-doctor', () => {
    doctorSocket = socket;
    console.log('Doctor registered:', socket.id);
  });

  socket.on('call-next', () => {
    if (!doctorSocket || queue.length === 0) return;

    const nextPatient = queue.shift();
    patientStartTimes[nextPatient.socketId] = Date.now();
    currentCallPatientId = nextPatient.socketId;

    doctorSocket.emit('calling-patient', {
      patientId: nextPatient.patientId,
      socketId: nextPatient.socketId
    });

    io.to(nextPatient.socketId).emit('join-call', {
      doctorSocketId: doctorSocket.id
    });

    sendQueueUpdates(); // update remaining patients
  });

  socket.on('end_call', () => {
    const start = patientStartTimes[socket.id];
    if (start) {
      const duration = (Date.now() - start) / 60000;
      durations.push(duration);
      console.log(`Call duration: ${duration.toFixed(2)} mins`);
      delete patientStartTimes[socket.id];
    }

    if (socket.id === currentCallPatientId) {
      currentCallPatientId = null;
    }

    sendQueueUpdates();
  });

  socket.on('signal', ({ to, signal }) => {
    io.to(to).emit('signal', { from: socket.id, signal });
  });

  socket.on('disconnect', () => {
    queue = queue.filter(p => p.socketId !== socket.id);
    delete patientStartTimes[socket.id];
    if (socket === doctorSocket) doctorSocket = null;
    if (socket.id === currentCallPatientId) currentCallPatientId = null;
    console.log('Disconnected:', socket.id);
    sendQueueUpdates();
  });
});

// Util: Broadcast wait time to patients based on their queue position
function sendQueueUpdates() {
  const avg = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 5;

  queue.forEach((patient, index) => {
    const estimatedTime = (index + 1) * avg;

    // Don't send wait time to patient in call
    if (patient.socketId !== currentCallPatientId) {
      io.to(patient.socketId).emit('update_wait_time', estimatedTime);
    }
  });
}

server.listen(3000, () => {
  console.log('✅ Server running at http://localhost:3000');
});
