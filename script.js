const socket = io();
const isDoctor = window.location.pathname.includes('doctor');
let peer;
let localStream;
let remoteSocketId;
let timerInterval;
let startTime;
let currentVideoDeviceId;
let audioEnabled = true;
let videoEnabled = true;

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const status = document.getElementById('status');

const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const switchBtn = document.getElementById('switchBtn');
const hangupBtn = document.getElementById('hangupBtn');
const nextBtn = document.getElementById('nextBtn');
const joinQueueBtn = document.getElementById('joinQueue');
const waitTimeDiv = document.getElementById('waitTime');

navigator.mediaDevices.getUserMedia({ video: true, audio: true })
  .then(stream => {
    console.log("✅ Got local stream");
    localStream = stream;
    localVideo.srcObject = stream;

    const videoTrack = stream.getVideoTracks()[0];
    currentVideoDeviceId = videoTrack.getSettings().deviceId;

    enableControls();

    if (isDoctor) {
      socket.emit('register-doctor');
      nextBtn.onclick = () => {
        socket.emit('call-next');
      };
    } else {
      joinQueueBtn.onclick = () => {
        const patientId = 'patient-' + Math.floor(Math.random() * 10000);
        socket.emit('join-queue', patientId);
        status.innerText = 'Joined queue...';
      };
    }
  })
  .catch(err => {
    console.error('❌ Media error:', err);
    status.innerText = 'Camera or microphone access denied.';
  });

function enableControls() {
  if (muteBtn) {
    muteBtn.disabled = false;
    videoBtn.disabled = false;
    switchBtn.disabled = false;
    hangupBtn.disabled = false;

    muteBtn.onclick = () => {
      audioEnabled = !audioEnabled;
      localStream.getAudioTracks()[0].enabled = audioEnabled;
      muteBtn.innerText = audioEnabled ? 'Mute Audio' : 'Unmute Audio';
    };

    videoBtn.onclick = () => {
      videoEnabled = !videoEnabled;
      localStream.getVideoTracks()[0].enabled = videoEnabled;
      videoBtn.innerText = videoEnabled ? 'Stop Video' : 'Start Video';
    };

    switchBtn.onclick = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      const nextDevice = videoDevices.find(d => d.deviceId !== currentVideoDeviceId);
      if (!nextDevice) return alert('No other camera found.');

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: nextDevice.deviceId } },
        audio: true
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      const sender = peer.streams[0].getVideoTracks()[0];

      peer.replaceTrack(sender, newVideoTrack, peer.streams[0]);
      localStream.getVideoTracks()[0].stop();
      localStream.removeTrack(localStream.getVideoTracks()[0]);
      localStream.addTrack(newVideoTrack);
      localVideo.srcObject = localStream;
      currentVideoDeviceId = nextDevice.deviceId;
    };

    hangupBtn.onclick = () => {
      if (peer) {
        peer.destroy();
        peer = null;
      }
      remoteVideo.srcObject = null;
      status.innerText = 'Call ended.';
      clearInterval(timerInterval);
      socket.emit('end_call'); // ✅ tell server to log duration
    };
  }
}

socket.on('join-call', ({ doctorSocketId }) => {
  remoteSocketId = doctorSocketId;
  status.innerText = 'Doctor is calling...';
  createPeer(true); // patient initiates
});

socket.on('calling-patient', ({ socketId, patientId }) => {
  if (!socketId) {
    status.innerText = 'No patients in the queue.';
    nextBtn.disabled = true;
    return;
  }
  remoteSocketId = socketId;
  status.innerText = `Calling patient ${patientId}`;
  createPeer(false); // doctor waits
});

socket.on('signal', ({ from, signal }) => {
  if (peer) {
    peer.signal(signal);
  } else {
    console.warn("⚠️ Signal received before peer creation.");
  }
});

function createPeer(initiator) {
  console.log("🛠 Creating peer. Initiator:", initiator);

  peer = new SimplePeer({
    initiator,
    trickle: false,
    stream: localStream
  });

  peer.on('signal', signal => {
    socket.emit('signal', { to: remoteSocketId, signal });
  });

  peer.on('stream', stream => {
    remoteVideo.srcObject = stream;
    status.innerText = 'Connected! Receiving remote stream.';
    startTimer();
    socket.emit('start_call'); // ✅ Notify server when call begins
  });

  peer.on('connect', () => {
    console.log("✅ Peer connected");
    peer.send("Hello!");
  });

  peer.on('data', data => {
    console.log("📨 Message from peer:", data.toString());
  });

  peer.on('close', () => {
    console.warn("🔒 Peer connection closed");
    remoteVideo.srcObject = null;
    status.innerText = 'Call ended.';
    clearInterval(timerInterval);
    socket.emit('end_call'); // ✅ Notify server when call ends
  });

  peer.on('error', err => {
    console.error("❌ Peer error:", err);
    status.innerText = 'Connection error.';
  });

  peer._pc.oniceconnectionstatechange = () => {
    const state = peer._pc.iceConnectionState;
    console.log("📶 ICE State:", state);
    status.innerText = `Connection: ${state}`;
  };
}

function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    status.innerText = `Connected • ${mins}:${secs}`;
  }, 1000);
}

// ✅ Wait time display (only for waiting patients)
socket.on('update_wait_time', avgTimeInMinutes => {
  if (!isDoctor && waitTimeDiv) {
    waitTimeDiv.textContent = `Estimated Wait Time: ${avgTimeInMinutes.toFixed(1)} minutes`;
  }
});
