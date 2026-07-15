export class NetworkManager {
  constructor(gameInstance) {
    this.game = gameInstance;

    if (typeof io !== "undefined") {
      const isLocal =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1";
      const socketUrl =
        isLocal && window.location.port !== "3000"
          ? "http://localhost:3000"
          : window.location.origin;

      console.log("🔌 Attempting to connect to socket server:", socketUrl);
      this.socket = io(socketUrl);
      this.setupSocketEvents(); // ✅ Sirf EK baar
    } else {
      console.error("❌ Socket.io not found!");
    }

    this.roomId = localStorage.getItem("ludoRoomId") || null;
    this.sessionId = localStorage.getItem("ludoSessionId") || null;
    this.userUUID = localStorage.getItem("ludoUserUUID") || this._genUUID();
    this.playerColor = null;

    this.peers = {};
    this.dataChannels = {};
    this.remoteAudioEls = {};
    this.socketIds = {};
    this.socketIdColors = {};
    this.localStream = null;
    this.isMicOn = false;
    this.globalSpeakerEnabled = true;
    this.mutedPlayerColors = new Set();
    this.pendingCandidates = {}; // Buffer candidates arriving before remote description


    this.onFriendInvite = null;
    this.onAutoRejoin = null;

    // ❌ REMOVED: this.setupSocketEvents(); — was causing duplicate events
  }

  _genUUID() {
    const id =
      "u-" +
      Math.random().toString(36).substring(2, 10) +
      Date.now().toString(36);
    localStorage.setItem("ludoUserUUID", id);
    return id;
  }

  setupSocketEvents() {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      console.log("✅ WebSocket connected:", this.socket.id);
      const name = localStorage.getItem("ludoLastName") || "Player";
      this._emitRegister(name);

      // Auto-rejoin if we have stored session and room
      if (this.roomId && this.sessionId) {
        this.attemptAutoRejoin(name);
      }
    });

    this.socket.on("disconnect", () => {
      console.log("❌ WebSocket disconnected");
    });

    this.socket.on("connect_error", (error) => {
      console.error("❌ WebSocket connection error:", error);
    });

    this.socket.on("room-update", (data) => {
      const oldSocketIds = { ...this.socketIds };
      this.socketIds = {};
      this.socketIdColors = {};
      data.players.forEach((p) => {
        if (p.socketId) {
          this.socketIds[p.color] = p.socketId;
          this.socketIdColors[p.socketId] = p.color;
        }
      });
      this.applyRemoteAudioMuteStates();
      this.game.updateLobbyPlayers(data);

      // ✅ PROACTIVE: If my mic is on, connect to any new socket IDs
      if (this.isMicOn || this.localStream) {
        Object.values(this.socketIds).forEach((sid) => {
          if (sid !== this.socket.id && !this.peers[sid]) {
            console.log(`🆕 New player detected in room-update, connecting to ${sid}`);
            this.createPeerConnection(sid);
          }
        });
      }
    });

    this.socket.on("game-started", (state) => {
      if (this.game.gameState === "lobby" || this.game.gameState === "setup") {
        this.game.startGameFromServer(state);
      }
    });

    this.socket.on("state-update", (state) => {
      this.game.syncState(state);
    });

    this.socket.on("timer-sync", (data) => {
      this.game.syncTimer(data);
    });

    this.socket.on("dice-rolled", (data) => {
      this.game.playRemoteDiceRoll(data.value, data.byPlayer, data.id);
    });

    this.socket.on("token-moved", (data) => {
      this.game.playRemoteTokenMove(
        data.player,
        data.index,
        data.toSteps,
        data.finishedInHome,
        data.lapCount,
      );
    });

    this.socket.on("tokens-killed", ({ movedToken, killed }) => {
      this.game.playKills(killed);
    });

    this.socket.on(
      "waiting-for-junction",
      ({ player, tokenIndex, remaining, atStep }) => {
        this.game.syncJunctionChoice(player, tokenIndex, remaining, atStep);
      },
    );

    this.socket.on("game-over", (data) => {
      this.game.showWinner(data.winner);
    });

    this.socket.on("player-reconnected", (data) => {
      this.game.showPlayerReconnected(data.playerColor, data.playerName);
    });

    this.socket.on("chat-message", (data) => {
      if (data.message.senderId && data.message.senderId === this.sessionId)
        return;
      // WebSocket chat fallback
      this.game.chat.addMessage(
        data.message.sender,
        data.message.text,
        data.message.color,
      );
      const senderPlayerId = Number.isInteger(data.message.playerId)
        ? data.message.playerId
        : data.message.sender;
      this.game.showAvatarMessage(senderPlayerId, data.message.text);
    });

    this.socket.on("friend-invite", (data) => {
      if (typeof this.onFriendInvite === "function") {
        this.onFriendInvite(data);
      }
    });

    this.socket.on("voice-signal", async ({ fromSocketId, signal }) => {
      if (!fromSocketId || fromSocketId === this.socket.id) return;

      const pc = this.peers[fromSocketId];
      if (!pc) {
        // Only create if we receive an offer or if we are the "impolite" peer
        // However, with Perfect Negotiation, we can just create it on first signal
        console.log(`📞 Signaling received from ${fromSocketId}, creating connection`);
        this.createPeerConnection(fromSocketId);
      }
      
      const peer = this.peers[fromSocketId];
      if (!peer) return;

      try {
        if (signal.type === "offer") {
          const polite = this.socket.id < fromSocketId;
          const offerCollision = peer.makingOffer || peer.signalingState !== "stable";

          peer.ignoreOffer = !polite && offerCollision;
          if (peer.ignoreOffer) {
            console.log(`⛔ Glare: Ignoring offer from ${fromSocketId} (we are impolite)`);
            return;
          }

          console.log(`📡 Received offer from ${fromSocketId}`);
          await peer.setRemoteDescription(new RTCSessionDescription(signal));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          this.socket.emit("voice-signal", {
            roomId: this.roomId,
            toSocketId: fromSocketId,
            signal: peer.localDescription,
          });

          // Process buffered candidates
          if (this.pendingCandidates[fromSocketId]) {
            for (const cand of this.pendingCandidates[fromSocketId]) {
              await peer.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
            delete this.pendingCandidates[fromSocketId];
          }
        } else if (signal.type === "answer") {
          console.log(`📡 Received answer from ${fromSocketId}`);
          await peer.setRemoteDescription(new RTCSessionDescription(signal));
          
          if (this.pendingCandidates[fromSocketId]) {
            for (const cand of this.pendingCandidates[fromSocketId]) {
              await peer.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
            delete this.pendingCandidates[fromSocketId];
          }
        } else if (signal.candidate) {
          try {
            if (peer.remoteDescription && peer.remoteDescription.type) {
              await peer.addIceCandidate(new RTCIceCandidate(signal));
            } else {
              if (!this.pendingCandidates[fromSocketId]) this.pendingCandidates[fromSocketId] = [];
              this.pendingCandidates[fromSocketId].push(signal);
            }
          } catch (err) {
            if (!peer.ignoreOffer) console.warn("ICE candidate error:", err);
          }
        }
      } catch (e) {
        console.error("❌ Signaling error:", e);
      }
    });

    this.socket.on("peer-voice-status", ({ sessionId, color, isMicOn }) => {
      this.game.updatePeerVoiceStatus(sessionId, color, isMicOn);
    });

    // Handle peer disconnecting for voice cleanup
    this.socket.on("peer-disconnected", ({ socketId }) => {
      this.cleanupPeerConnection(socketId);
    });
  }

  registerUser(name) {
    localStorage.setItem("ludoLastName", name);
    this._emitRegister(name);
  }

  _emitRegister(name) {
    this.socket.emit("register-user", { uuid: this.userUUID, name });
  }

  attemptAutoRejoin(name) {
    console.log(
      `Attempting auto-rejoin to room ${this.roomId} with session ${this.sessionId}`,
    );
    this.socket.emit(
      "join-room",
      { roomId: this.roomId, name, sessionId: this.sessionId },
      (res) => {
        if (res.success) {
          console.log("Auto-rejoin successful");
          this.playerColor = res.playerColor;
          // Notify the UI about successful rejoin
          if (typeof this.onAutoRejoin === "function") {
            this.onAutoRejoin(res);
          }
        } else {
          console.log("Auto-rejoin failed:", res.error);
          // Clear stored session data if rejoin fails
          this.clearStoredSession();
        }
      },
    );
  }

  clearStoredSession() {
    localStorage.removeItem("ludoRoomId");
    localStorage.removeItem("ludoSessionId");
    this.roomId = null;
    this.sessionId = null;
  }

  leaveRoom() {
    // Notify server to leave the current room
    if (this.roomId) {
      this.socket.emit("leave-room", {
        roomId: this.roomId,
        sessionId: this.sessionId,
      });
    }
    this.clearStoredSession();

    // Cleanup all peer connections
    Object.keys(this.peers).forEach(sid => this.cleanupPeerConnection(sid));
  }

  createRoom(name, count, teamUpMode, callback) {
    if (!this.socket || !this.socket.connected) {
      callback({
        success: false,
        error: "Server se connection nahi hai. Reload karein.",
      });
      return;
    }

    this.socket.emit("create-room", { name, count, teamUpMode }, (res) => {
      if (res.success) {
        this.roomId = res.roomId;
        this.sessionId = res.sessionId;
        this.playerColor = res.playerColor;
        localStorage.setItem("ludoRoomId", this.roomId);
        localStorage.setItem("ludoSessionId", this.sessionId);
      }
      callback(res);
    });
  }

  joinRoom(roomId, name, callback) {
    this.socket.emit(
      "join-room",
      { roomId, name, sessionId: this.sessionId },
      (res) => {
        if (res.success) {
          this.roomId = roomId;
          this.sessionId = res.sessionId;
          this.playerColor = res.playerColor;
          localStorage.setItem("ludoRoomId", this.roomId);
          localStorage.setItem("ludoSessionId", this.sessionId);
          callback(res);
        } else {
          callback(res);
        }
      },
    );
  }

  startGame() {
    this.socket.emit("start-game", {
      roomId: this.roomId,
      sessionId: this.sessionId,
    });
  }

  checkFriendsStatus(uuids, callback) {
    this.socket.emit("check-friends-status", { uuids }, (statuses) => {
      callback(statuses);
    });
  }

  inviteFriend(targetUUID, targetName, roomId) {
    const senderName = localStorage.getItem("ludoLastName") || "Someone";
    const senderColor = this.playerColor ?? 0;
    this.socket.emit("invite-friend", {
      targetUUID,
      senderName,
      senderColor,
      roomId,
    });
  }

  rollDice() {
    this.socket.emit(
      "roll-dice",
      {
        roomId: this.roomId,
        sessionId: this.sessionId,
      },
      (res) => {
        if (!res?.success) {
          console.warn("Dice roll rejected by server:", res?.error || res);
        }
      },
    );
  }

  moveToken(tokenIndex, rollValue) {
    this.socket.emit("move-token", {
      roomId: this.roomId,
      sessionId: this.sessionId,
      tokenIndex,
      rollValue,
    });
  }

  selectJunction(choice) {
    this.socket.emit("junction-choice", {
      roomId: this.roomId,
      sessionId: this.sessionId,
      choice,
    });
  }

  sendChat(text, senderName, color) {
    const messageObj = {
      senderId: this.sessionId,
      playerId: this.playerColor,
      playerColor: color,
      sender: senderName,
      text,
      timestamp: Date.now(),
      color,
    };

    // Chat and emoji UI sync must go through the server so every POV receives
    // the same player id and can render the bubble on its own layout.
    this.socket.emit("chat-message", {
      roomId: this.roomId,
      message: messageObj,
    });
  }

  toggleBot(enabled) {
    this.socket.emit("toggle-bot", {
      roomId: this.roomId,
      sessionId: this.sessionId,
      enabled,
    });
  }

  sendActivity() {
    if (this.roomId && this.sessionId) {
      this.socket.emit("player-activity", {
        roomId: this.roomId,
        sessionId: this.sessionId,
      });
    }
  }

  async toggleMic() {
    // ✅ Check if we are in a secure context (HTTPS)
    if (typeof window !== "undefined" && (!window.isSecureContext || !navigator.mediaDevices)) {
      console.error("❌ Mic blocked: HTTPS is REQUIRED for mobile voice chat.");
      alert("Voice chat ke liye HTTPS zaroori hai.");
      return false;
    }

    if (!this.localStream) {
      try {
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });

        console.log("🎤 Local stream acquired:", this.localStream.id);
        this.localStream.getAudioTracks().forEach((track) => {
          console.log("🎤 Local track:", track.label, "state:", track.readyState);
          track.enabled = true;

          // Handle track ended unexpectedly
          track.onended = () => {
            console.warn("🎤 Local track ended unexpectedly");
            if (this.isMicOn) {
              this.localStream = null;
              this.isMicOn = false;
              this.broadcastVoiceStatus();
            }
          };
        });

        this.isMicOn = true;
        this.broadcastVoiceStatus();

        // Add tracks to existing peer connections
        this.addLocalTracksToPeers();

        // ✅ If we have a local stream, ensure we are connected to everyone
        Object.values(this.socketIds).forEach((sid) => {
          if (sid !== this.socket.id && !this.peers[sid]) {
            console.log(`🎤 Mic ON: Initiating connection to existing peer ${sid}`);
            this.createPeerConnection(sid);
          }
        });

      } catch (e) {
        console.error("❌ Mic access denied:", e);
        alert("Microphone access nahi mila. Settings check karein.");
        return false;
      }
    } else {
      // ✅ Toggle existing tracks
      this.isMicOn = !this.isMicOn;
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = this.isMicOn;
        // If track died, we need to re-acquire
        if (this.isMicOn && track.readyState === 'ended') {
          this.localStream = null;
          return this.toggleMic();
        }
      });
      this.broadcastVoiceStatus();
    }
    return this.isMicOn;
  }

  broadcastVoiceStatus() {
    this.socket.emit("voice-status", {
      roomId: this.roomId,
      sessionId: this.sessionId,
      isMicOn: this.isMicOn,
    });
  }

  setGlobalSpeakerEnabled(enabled) {
    this.globalSpeakerEnabled = Boolean(enabled);
    this.applyRemoteAudioMuteStates();
    // Re-try play after toggling (mobile autoplay policies)
    this.unlockAudioContextAndRetry("speaker-toggle");
  }

  setPlayerMuted(color, muted) {
    if (muted) this.mutedPlayerColors.add(color);
    else this.mutedPlayerColors.delete(color);
    const socketId = this.socketIds[color];
    if (socketId) this.applyRemoteAudioMuteState(socketId);
  }

  isRemoteAudioMutedForColor(color) {
    return !this.globalSpeakerEnabled || this.mutedPlayerColors.has(color);
  }

  applyRemoteAudioMuteStates() {
    Object.keys(this.remoteAudioEls).forEach((socketId) => {
      this.applyRemoteAudioMuteState(socketId);
    });
  }

  applyRemoteAudioMuteState(socketId) {
    const audio = this.remoteAudioEls[socketId];
    if (!audio) return;

    const color = this.socketIdColors[socketId];
    const muted =
      !this.globalSpeakerEnabled ||
      (color !== undefined && this.mutedPlayerColors.has(color));

    audio.muted = muted;
    audio.volume = muted ? 0 : 1.0; 

    if (audio.srcObject) {
      audio.srcObject.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }

    if (muted) {
      audio.pause();
    } else if (audio.srcObject) {
      audio.play().catch((e) => {
        if (e.name !== "AbortError") {
          console.debug("Audio play deferred (waiting for gesture):", e);
        }
      });
    }
  }

  addLocalTracksToPeers() {
    if (!this.localStream) return;
    const localTrack = this.localStream.getAudioTracks()[0];
    if (!localTrack) return;

    Object.entries(this.peers).forEach(([socketId, pc]) => {
      try {
        const senders = pc.getSenders();
        const audioSender = senders.find((s) => s.track && s.track.kind === "audio");

        if (audioSender) {
          console.log("🔄 Replacing audio track for", socketId);
          audioSender.replaceTrack(localTrack).catch(e => {
            console.warn("replaceTrack failed, adding normally:", e);
            pc.addTrack(localTrack, this.localStream);
          });
        } else {
          console.log("➕ Adding audio track to", socketId);
          pc.addTrack(localTrack, this.localStream);
        }
      } catch (e) {
        console.error("Error adding track to peer", socketId, e);
      }
    });
  }

  createPeerConnection(targetSocketId) {
    if (this.peers[targetSocketId]) return;
    if (targetSocketId === this.socket.id) return;

    console.log(`🤝 Creating PeerConnection for ${targetSocketId}`);

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.makingOffer = false;
    pc.ignoreOffer = false;

    this.peers[targetSocketId] = pc;

    pc.onnegotiationneeded = async () => {
      try {
        pc.makingOffer = true;
        await pc.setLocalDescription();
        this.socket.emit("voice-signal", {
          roomId: this.roomId,
          toSocketId: targetSocketId,
          signal: pc.localDescription,
        });
      } catch (err) {
        console.error("Negotiation error:", err);
      } finally {
        pc.makingOffer = false;
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit("voice-signal", {
          roomId: this.roomId,
          toSocketId: targetSocketId,
          signal: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (!remoteStream) return;

      console.log(`📡 Remote track received from ${targetSocketId}`);
      
      let audio = this.remoteAudioEls[targetSocketId];
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.playsInline = true;
        audio.style.display = "none";
        document.body.appendChild(audio); // CRITICAL for AEC
        this.remoteAudioEls[targetSocketId] = audio;
      }

      if (audio.srcObject !== remoteStream) {
        audio.srcObject = remoteStream;
      }
      
      this.applyRemoteAudioMuteState(targetSocketId);
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        pc.restartIce().catch(() => {});
      }
    };

    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, this.localStream);
      });
    }

    // Data Channel
    pc.ondatachannel = (event) => {
      this.setupDataChannel(targetSocketId, event.channel);
    };

    // We create the channel as well to ensure it exists
    const dc = pc.createDataChannel("chat");
    this.setupDataChannel(targetSocketId, dc);
  }

  setupDataChannel(sid, dc) {
    this.dataChannels[sid] = dc;
    dc.onopen = () => console.log(`DataChannel [${sid}] is OPEN`);
    dc.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "chat") {
          if (data.senderId && data.senderId === this.sessionId) return;
          this.game.chat.addMessage(data.sender, data.text, data.color);
          const senderPlayerId = Number.isInteger(data.playerId) ? data.playerId : data.sender;
          this.game.showAvatarMessage(senderPlayerId, data.text);
        }
      } catch (e) {
        console.warn("DataChannel message error:", e);
      }
    };
    dc.onclose = () => console.log(`DataChannel [${sid}] is CLOSED`);
  }

  cleanupPeerConnection(targetSocketId) {
    console.log(`🧹 Cleaning up connection for ${targetSocketId}`);
    const pc = this.peers[targetSocketId];
    if (pc) {
      pc.onnegotiationneeded = null;
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      delete this.peers[targetSocketId];
    }

    const audio = this.remoteAudioEls[targetSocketId];
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      delete this.remoteAudioEls[targetSocketId];
    }

    const dc = this.dataChannels[targetSocketId];
    if (dc) {
      dc.close();
      delete this.dataChannels[targetSocketId];
    }
  }

  unlockAudioContextAndRetry(reason = "unknown") {
    try {
      // Lazily create/resume an AudioContext on user gesture
      if (!this._audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this._audioCtx = new Ctx();
        console.log("🔊 AudioContext created:", this._audioCtx.state, "reason:", reason);
      } else {
        console.log("🔊 AudioContext state:", this._audioCtx.state, "reason:", reason);
      }

      if (this._audioCtx && this._audioCtx.state === "suspended") {
        this._audioUnlocked = false;
        this._audioCtx.resume()
          .then(() => {
            this._audioUnlocked = true;
            console.log("🔊 AudioContext resumed:", this._audioCtx.state);
          })
          .catch((e) => console.warn("🔊 AudioContext resume failed:", e));
      } else {
        this._audioUnlocked = true;
      }
    } catch (e) {
      console.warn("🔊 unlockAudioContextAndRetry error:", e);
    }

    // Retry remote audio elements
    try {
      Object.keys(this.remoteAudioEls).forEach((sid) => {
        this.applyRemoteAudioMuteState(sid);
      });
    } catch {
      // ignore
    }
  }

  getSocketStatus() {
    return {
      ioAvailable: typeof io !== "undefined",
      socketExists: !!this.socket,
      connected: this.socket?.connected,
      id: this.socket?.id,
      url: this.socket?.io?.uri,
    };
  }
}
