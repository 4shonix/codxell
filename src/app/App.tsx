import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Paperclip, Smile, Send, Pencil, Trash, Copy, Flag, X, LogOut, SkipForward, Mic, Reply, StopCircle, User, Camera, Bell, BellOff } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import * as crypto from '../utils/crypto';

export default function App() {
  const [view, setView] = useState<'home' | 'chat'>('home');
  const [isLoading, setIsLoading] = useState(false);
  const [showHeader, setShowHeader] = useState(false);
  const [inputMoved, setInputMoved] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<Array<{
    id: number;
    text: string;
    sender: 'user' | 'other' | 'system';
    type?: 'text' | 'file';
    fileContent?: string;
    fileType?: string;
    isEdited?: boolean;
    isDeleted?: boolean;
    replyTo?: { id: number; text: string; sender: string; type?: string; fileContent?: string; fileType?: string };
  }>>([]);
  const [hoveredMessage, setHoveredMessage] = useState<number | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [username, setUsername] = useState(() => localStorage.getItem('stranger_username') || '');
  const [profilePic, setProfilePic] = useState<string | null>(() => localStorage.getItem('stranger_profile_pic'));
  const [partnerName, setPartnerName] = useState<string>('Stranger');
  const [partnerProfilePic, setPartnerProfilePic] = useState<string | null>(null);
  const [showEscModal, setShowEscModal] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [isChatActive, setIsChatActive] = useState(false);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<{ type: 'image' | 'video', url: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [replyingTo, setReplyingTo] = useState<{ id: number; text: string; sender: string; type?: string; fileContent?: string; fileType?: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random()}`);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [encryptionEnabled, setEncryptionEnabled] = useState(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const myKeysRef = useRef<crypto.KeyPair | null>(null);
  const partnerPublicKeyRef = useRef<CryptoKey | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profilePicInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isPartnerTyping]);

  // Handle animation sequence when loading finishes
  useEffect(() => {
    if (!isLoading && view === 'chat') {
      const timer = setTimeout(() => {
        setInputMoved(true);
        setShowHeader(true);
      }, 800);
      return () => clearTimeout(timer);
    } else {
      setInputMoved(false);
      setShowHeader(false);
    }
  }, [isLoading, view]);

  // Session management - warn about duplicate tabs but don't block
  useEffect(() => {
    const activeSession = localStorage.getItem('active_session');

    if (activeSession && activeSession !== sessionId) {
      setShowDuplicateWarning(true);
    } else {
      localStorage.setItem('active_session', sessionId);
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'active_session' && e.newValue && e.newValue !== sessionId) {
        setShowDuplicateWarning(true);
      }
    };

    const handleFocus = () => {
      const currentActiveSession = localStorage.getItem('active_session');
      if (!currentActiveSession || currentActiveSession !== sessionId) {
        localStorage.setItem('active_session', sessionId);
        setShowDuplicateWarning(false);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', handleFocus);
      if (localStorage.getItem('active_session') === sessionId) {
        localStorage.removeItem('active_session');
      }
    };
  }, [sessionId]);

  useEffect(() => {
    // Connect to backend
    socketRef.current = io();

    socketRef.current.on('connect', () => {
      console.log('Connected to server');
    });

    socketRef.current.on('chat_start', (data: { roomId: string, partnerName?: string, partnerProfilePic?: string }) => {
      console.log('Chat started:', data.roomId);
      setRoomId(data.roomId);
      setPartnerName(data.partnerName || 'Stranger');
      setPartnerProfilePic(data.partnerProfilePic || null);
      setMessages([]); // Clear previous messages
      setIsLoading(false);
      setView('chat');
      setIsChatActive(true);
    });

    socketRef.current.on('receive_message', (data: any) => {
      setMessages((prev) => [...prev, { ...data, sender: 'other' }]);
    });

    socketRef.current.on('message_edited', (data: { id: number, text: string }) => {
      setMessages((prev) => prev.map(msg => msg.id === data.id ? { ...msg, text: data.text, isEdited: true } : msg));
    });

    socketRef.current.on('message_deleted', (data: { id: number }) => {
      setMessages((prev) => prev.map(msg => msg.id === data.id ? { ...msg, isDeleted: true } : msg));
    });

    socketRef.current.on('partner_disconnected', () => {
      setMessages((prev) => [...prev, { id: Date.now(), text: 'Stranger has disconnected.', sender: 'system' }]);
      setIsChatActive(false);
      setIsPartnerTyping(false);
    });

    socketRef.current.on('typing', () => setIsPartnerTyping(true));
    socketRef.current.on('stop_typing', () => setIsPartnerTyping(false));

    socketRef.current.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason);
      // Optional: Attempt to reconnect or show UI feedback
      if (reason === 'io server disconnect') {
        // the disconnection was initiated by the server, you need to reconnect manually
        socketRef.current?.connect();
      }
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  // Handle page refresh/close confirmation
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (view === 'chat' || isLoading) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [view, isLoading]);

  // Removed the second useEffect that was causing auto-join loops/flashing

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view === 'chat') {
          setShowEscModal(prev => !prev);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view]);

  const handleFindSomeone = () => {
    if (!username.trim()) return;
    try {
      localStorage.setItem('stranger_username', username);
      if (profilePic) localStorage.setItem('stranger_profile_pic', profilePic);
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }

    setIsLoading(true);
    setView('chat');
    socketRef.current?.emit('join_queue', { username, profilePic });
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((message.trim() || isRecording) && roomId) {
      const id = Date.now();
      const newMessage = {
        id,
        text: message,
        sender: 'user' as const,
        type: 'text' as const,
        replyTo: replyingTo || undefined
      };
      setMessages((prev) => [...prev, newMessage]);
      socketRef.current?.emit('send_message', {
        roomId,
        text: message,
        sender: 'user',
        type: 'text',
        id,
        replyTo: replyingTo
      });
      setMessage('');
      setReplyingTo(null);
      socketRef.current?.emit('stop_typing', { roomId });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);
    if (roomId) {
      socketRef.current?.emit('typing', { roomId });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socketRef.current?.emit('stop_typing', { roomId });
      }, 1000);
    }
  };

  const handleNext = () => {
    setIsLoading(true);
    setRoomId(null);
    setShowEscModal(false);
    setIsChatActive(false);
    socketRef.current?.emit('skip');
    // Add a small delay before re-joining to allow server to process skip
    setTimeout(() => {
      setTimeout(() => {
        socketRef.current?.emit('join_queue', { username, profilePic });
      }, 100);
    }, 100);
  };

  const handleQuit = () => {
    socketRef.current?.emit('skip'); // Disconnect from current chat
    setRoomId(null);
    setIsChatActive(false);
    setMessages(prev => [...prev, { id: Date.now(), text: 'You have disconnected.', sender: 'system' }]);
    setShowEscModal(false);
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && roomId) {
      // Simulate upload progress
      const totalSize = (file.size / (1024 * 1024)).toFixed(2); // MB
      let currentSize = 0;
      const interval = setInterval(() => {
        currentSize += 0.5; // Simulate 0.5MB chunks
        if (currentSize >= parseFloat(totalSize)) {
          currentSize = parseFloat(totalSize);
          clearInterval(interval);
          setUploadProgress(null);
        } else {
          setUploadProgress(`${currentSize.toFixed(2)}MB / ${totalSize}MB`);
        }
      }, 200);

      const reader = new FileReader();
      reader.onload = (evt) => {
        const content = evt.target?.result as string;
        const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'audio';
        const id = Date.now();

        const newMessage = {
          id,
          text: file.name,
          sender: 'user' as const,
          type: 'file' as const,
          fileContent: content,
          fileType: type
        };
        setMessages((prev) => [...prev, newMessage]);
        socketRef.current?.emit('send_message', {
          roomId,
          text: file.name,
          sender: 'user',
          type: 'file',
          fileContent: content,
          fileType: type,
          id
        });
      };
      reader.readAsDataURL(file);
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleProfilePicSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const content = evt.target?.result as string;
        setProfilePic(content);
        try {
          localStorage.setItem('stranger_profile_pic', content);
        } catch (e) {
          console.error('Failed to save profile pic to localStorage:', e);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          if (roomId) {
            const id = Date.now();
            const newMessage = {
              id,
              text: 'Audio Message',
              sender: 'user' as const,
              type: 'file' as const,
              fileContent: base64Audio,
              fileType: 'audio'
            };
            setMessages((prev) => [...prev, newMessage]);
            socketRef.current?.emit('send_message', {
              roomId,
              text: 'Audio Message',
              sender: 'user',
              type: 'file',
              fileContent: base64Audio,
              fileType: 'audio',
              id
            });
          }
        };
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Stop all tracks to release microphone
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleReply = (msg: { id: number; text: string; sender: string; type?: string; fileContent?: string; fileType?: string }) => {
    setReplyingTo(msg);
  };

  const cancelReply = () => {
    setReplyingTo(null);
  };

  const handleEmojiClick = () => {
    console.log('Emoji clicked');
  };

  const handleEdit = (id: number, text: string) => {
    setEditingMessageId(id);
    setEditText(text);
  };

  const submitEdit = (id: number) => {
    if (roomId) {
      setMessages(prev => prev.map(msg => msg.id === id ? { ...msg, text: editText, isEdited: true } : msg));
      socketRef.current?.emit('edit_message', { roomId, id, text: editText });
      setEditingMessageId(null);
      setEditText('');
    }
  };

  const handleDelete = (id: number) => {
    if (roomId) {
      setMessages(messages.map(msg => msg.id === id ? { ...msg, isDeleted: true } : msg));
      socketRef.current?.emit('delete_message', { roomId, id });
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    console.log('Copied:', text);
  };

  const handleReport = (id: number) => {
    console.log('Report message:', id);
  };



  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden">
      {/* Gradient Background with Movie Image */}
      {/* Background Video */}
      <div className="absolute inset-0 overflow-hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute w-full h-full object-cover"
        >
          <source src="/BGV.mp4" type="video/mp4" />
        </video>
        {/* Overlay to darken video */}
        <div className="absolute inset-0 bg-black/60" />
      </div>

      {/* Glass Overlay */}
      <div className="absolute inset-0 backdrop-blur-[2px] bg-black/10" />

      {/* Duplicate Tab Warning Banner */}
      <AnimatePresence>
        {showDuplicateWarning && (
          <motion.div
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-50 max-w-md mx-4"
          >
            <div className="bg-yellow-500/20 backdrop-blur-xl border border-yellow-500/50 rounded-xl p-4 shadow-lg">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <h3 className="text-white font-medium text-sm mb-1">Multiple Tabs Detected</h3>
                  <p className="text-white/80 text-xs">
                    This app is open in another tab. Using multiple tabs may cause sync issues.
                  </p>
                </div>
                <button
                  onClick={() => setShowDuplicateWarning(false)}
                  className="p-1 hover:bg-white/10 rounded-full transition-colors"
                >
                  <X className="w-4 h-4 text-white/80" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="relative z-10 w-full h-full flex flex-col items-center justify-center">

        {/* Home View */}
        {view === 'home' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex flex-col items-start gap-8 max-w-4xl w-full px-6 md:px-12"
          >
            <div className="space-y-4 md:space-y-2 w-full">
              <h1 className="text-5xl md:text-7xl font-bold text-white tracking-tighter drop-shadow-lg">
                Codxell
              </h1>
              <p className="text-white/60 text-lg md:text-xl max-w-2xl leading-relaxed">
                Experience seamless connections in a beautifully designed environment.
                Chat anonymously, share moments, and discover new conversations with people across the globe.
              </p>
            </div>

            <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4 w-full md:w-auto">
              {/* Profile Pic Upload */}
              <div className="relative group/profile flex-shrink-0 self-center md:self-auto">
                <input
                  type="file"
                  ref={profilePicInputRef}
                  className="hidden"
                  onChange={handleProfilePicSelect}
                  accept="image/*"
                />
                <button
                  onClick={() => profilePicInputRef.current?.click()}
                  className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-xl flex items-center justify-center overflow-hidden hover:bg-white/20 transition-all relative"
                >
                  {profilePic ? (
                    <img src={profilePic} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-8 h-8 text-white/50" />
                  )}
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover/profile:opacity-100 transition-opacity">
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                </button>
              </div>

              <input
                type="text"
                placeholder="Enter your name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="px-6 py-4 bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl text-white text-xl placeholder-white/40 outline-none focus:bg-white/20 transition-all w-full md:w-64"
                onKeyDown={(e) => e.key === 'Enter' && handleFindSomeone()}
              />
              <button
                onClick={handleFindSomeone}
                disabled={!username.trim()}
                className="group relative px-8 py-4 bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl text-white text-xl font-medium overflow-hidden shadow-xl hover:scale-105 active:scale-95 transition-transform duration-200 disabled:opacity-50 disabled:cursor-not-allowed w-full md:w-auto"
              >
                <span className="relative z-10">Start Chatting</span>
                <div
                  className="absolute inset-0 bg-gradient-to-r from-purple-500/50 via-pink-500/50 to-blue-500/50 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                />
              </button>
            </div>
          </motion.div>
        )}

        {/* Chat View */}
        {view === 'chat' && (
          <AnimatePresence mode="wait">
            {isLoading ? (
              /* Loading State */
              <motion.div
                key="loading"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{
                  opacity: 0,
                  scale: 0.8,
                }}
                transition={{
                  duration: 0.5,
                  ease: [0.25, 0.1, 0.25, 1]
                }}
                className="flex items-center gap-4"
              >
                {/* Simple rotating circle */}
                <motion.div
                  className="w-8 h-8 rounded-full border-3 border-white/30 border-t-white"
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 1,
                    repeat: Infinity,
                    ease: 'linear',
                  }}
                />

                {/* Loading text */}
                <motion.p
                  className="text-white/90 text-xl"
                  animate={{
                    opacity: [0.5, 1, 0.5],
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                >
                  finding stranger...
                </motion.p>
              </motion.div>
            ) : (
              /* Chat Interface */
              <motion.div
                key="chat"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6 }}
                className="w-full h-[96dvh] md:h-[92dvh] max-w-3xl px-2 md:px-4 py-2 md:py-4 flex flex-col relative overflow-hidden"
              >
                {/* Header */}
                <AnimatePresence>
                  {showHeader && (
                    <header className="mb-2 md:mb-3 px-1">
                      <div className="flex items-center justify-between">
                        {/* Left: Profile and Username */}
                        <div className="flex items-center gap-2">
                          {/* Profile Picture */}
                          <div className="relative flex-shrink-0">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center backdrop-blur-xl overflow-hidden shadow-md">
                              {partnerProfilePic ? (
                                <img
                                  src={partnerProfilePic}
                                  alt="Partner"
                                  className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                  onClick={() => setPreviewMedia({ type: 'image', url: partnerProfilePic })}
                                />
                              ) : (
                                <span className="text-white text-sm">{partnerName.substring(0, 2).toUpperCase()}</span>
                              )}
                            </div>
                          </div>

                          {/* Username */}
                          <div className="flex-shrink-0">
                            <h2 className="text-white/90 text-sm">{partnerName}</h2>
                          </div>
                        </div>

                        {/* Right: Next Button */}
                        <button
                          onClick={handleNext}
                          className="relative group px-5 py-2 rounded-lg bg-white/10 backdrop-blur-xl border border-white/20 text-white/90 text-sm hover:bg-white/20 transition-all duration-300 shadow-md hover:scale-105 active:scale-95"
                        >
                          <span className="relative z-10">Next</span>
                          {/* Glow effect */}
                          <div
                            className="absolute -inset-[1px] rounded-lg bg-gradient-to-r from-purple-500/50 to-pink-500/50 -z-10 blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                          />
                        </button>
                      </div>
                    </header>
                  )}
                </AnimatePresence>

                {/* Messages Container */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: inputMoved ? 1 : 0, y: inputMoved ? 0 : 20 }}
                  transition={{ delay: 0.5, duration: 0.8 }}
                  className="flex-1 overflow-y-auto mb-3 px-1 scrollbar-hide"
                  style={{
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                  }}
                >
                  <div className="min-h-full flex flex-col justify-end space-y-2">
                    {messages.map((msg, index) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.sender === 'user' ? 'justify-end' : msg.sender === 'system' ? 'justify-center' : 'justify-start'}`}
                        onMouseEnter={() => setHoveredMessage(msg.id)}
                        onMouseLeave={() => setHoveredMessage(null)}
                      >
                        {msg.sender === 'system' ? (
                          <div className="px-4 py-1 text-xs text-white/50 bg-black/20 rounded-full backdrop-blur-sm">
                            {msg.text}
                          </div>
                        ) : (
                          <div className="relative group max-w-[85%] md:max-w-[80%]">
                            {msg.isDeleted ? (
                              <div className="px-4 py-2.5 text-sm rounded-3xl backdrop-blur-2xl border shadow-md italic text-white/50 bg-white/5 border-white/10">
                                This message was deleted
                              </div>
                            ) : editingMessageId === msg.id ? (
                              <div className="flex gap-2 items-center bg-white/10 backdrop-blur-xl p-2 rounded-2xl border border-white/20">
                                <input
                                  type="text"
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                  className="bg-transparent text-white outline-none px-2 py-1 w-full"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') submitEdit(msg.id);
                                    if (e.key === 'Escape') setEditingMessageId(null);
                                  }}
                                />
                                <button onClick={() => submitEdit(msg.id)} className="p-1 hover:bg-white/10 rounded"><Send className="w-4 h-4 text-green-400" /></button>
                                <button onClick={() => setEditingMessageId(null)} className="p-1 hover:bg-white/10 rounded"><X className="w-4 h-4 text-red-400" /></button>
                              </div>
                            ) : (
                              <div
                                className={`relative text-sm shadow-md ${msg.sender === 'user'
                                  ? 'bg-gradient-to-br from-purple-500/40 to-pink-500/40 border-white/30 text-white'
                                  : 'bg-white/10 border-white/20 text-white/90'
                                  } ${msg.type === 'file' && (msg.fileType === 'image' || msg.fileType === 'video') ? 'p-0 rounded-2xl overflow-hidden border-none bg-transparent' : 'px-4 py-2.5 rounded-3xl backdrop-blur-2xl border'}`}
                              >
                                {msg.replyTo && (
                                  <div className={`mb-1 px-2 py-1 rounded-lg text-xs border-l-2 ${msg.sender === 'user' ? 'bg-black/10 border-white/50' : 'bg-white/10 border-purple-400'}`}>
                                    <span className="font-bold opacity-70 block">{msg.replyTo.sender === 'user' ? 'You' : 'Stranger'}</span>
                                    {msg.replyTo.type === 'file' ? (
                                      <div className="flex items-center gap-1 mt-0.5">
                                        {msg.replyTo.fileType === 'image' ? (
                                          <img src={msg.replyTo.fileContent} alt="Reply preview" className="w-8 h-8 rounded object-cover" />
                                        ) : msg.replyTo.fileType === 'video' ? (
                                          <div className="w-8 h-8 rounded bg-black/20 flex items-center justify-center">
                                            <div className="w-0 h-0 border-t-4 border-t-transparent border-l-6 border-l-white border-b-4 border-b-transparent ml-0.5"></div>
                                          </div>
                                        ) : (
                                          <div className="w-8 h-8 rounded bg-black/20 flex items-center justify-center">
                                            <Mic className="w-4 h-4 opacity-70" />
                                          </div>
                                        )}
                                        <span className="opacity-60 truncate max-w-[120px]">{msg.replyTo.text}</span>
                                      </div>
                                    ) : (
                                      <p className="opacity-60 truncate max-w-[150px]">{msg.replyTo.text}</p>
                                    )}
                                  </div>
                                )}
                                {msg.type === 'file' && msg.fileContent ? (
                                  msg.fileType === 'image' ? (
                                    <div className="relative">
                                      <img
                                        src={msg.fileContent}
                                        alt="Shared image"
                                        className="max-w-xs max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                        onClick={() => setPreviewMedia({ type: 'image', url: msg.fileContent! })}
                                      />
                                      {msg.sender === 'user' && uploadProgress && index === messages.length - 1 && (
                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                          <span className="text-white text-xs font-medium">{uploadProgress}</span>
                                        </div>
                                      )}
                                    </div>
                                  ) : msg.fileType === 'video' ? (
                                    <div className="relative">
                                      <video
                                        src={msg.fileContent}
                                        className="max-w-xs max-h-64 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                        onClick={() => setPreviewMedia({ type: 'video', url: msg.fileContent! })}
                                      />
                                      {msg.sender === 'user' && uploadProgress && index === messages.length - 1 && (
                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                          <span className="text-white text-xs font-medium">{uploadProgress}</span>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2">
                                      <audio controls src={msg.fileContent} className="h-8 w-48" />
                                    </div>
                                  )
                                ) : (
                                  <>
                                    {msg.text}
                                    {msg.isEdited && msg.sender !== 'user' && <span className="text-[10px] opacity-60 ml-1">(edited)</span>}
                                  </>
                                )}
                              </div>
                            )}

                            {/* Action Icons on Hover */}
                            {hoveredMessage === msg.id && !editingMessageId && !msg.isDeleted && (
                              <div
                                className={`absolute top-1/2 -translate-y-1/2 ${msg.sender === 'user' ? 'right-full mr-2' : 'left-full ml-2'
                                  } flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/15 backdrop-blur-xl border border-white/30 shadow-lg z-20`}
                              >
                                {msg.sender === 'user' && (
                                  <>
                                    <button
                                      onClick={() => handleEdit(msg.id, msg.text)}
                                      className="p-1 rounded-md hover:bg-white/20 transition-colors hover:scale-110 active:scale-90"
                                    >
                                      <Pencil className="w-3.5 h-3.5 text-white/80" />
                                    </button>
                                    <button
                                      onClick={() => handleDelete(msg.id)}
                                      className="p-1 rounded-md hover:bg-white/20 transition-colors hover:scale-110 active:scale-90"
                                    >
                                      <Trash className="w-3.5 h-3.5 text-red-300" />
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={() => handleCopy(msg.text)}
                                  className="p-1 rounded-md hover:bg-white/20 transition-colors hover:scale-110 active:scale-90"
                                >
                                  <Copy className="w-3.5 h-3.5 text-white/80" />
                                </button>
                                <button
                                  onClick={() => handleReply(msg)}
                                  className="p-1 rounded-md hover:bg-white/20 transition-colors hover:scale-110 active:scale-90"
                                >
                                  <Reply className="w-3.5 h-3.5 text-white/80" />
                                </button>
                                <button
                                  onClick={() => handleReport(msg.id)}
                                  className="p-1 rounded-md hover:bg-white/20 transition-colors hover:scale-110 active:scale-90"
                                >
                                  <Flag className="w-3.5 h-3.5 text-yellow-300" />
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Typing Indicator */}
                    {isPartnerTyping && (
                      <div className="flex justify-start">
                        <div className="px-4 py-3 bg-white/10 backdrop-blur-xl rounded-3xl rounded-tl-none border border-white/20 flex gap-1 items-center">
                          <div className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </motion.div>

                {/* Input Bar */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: 0 }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    y: 0,
                  }}
                  transition={{
                    opacity: { duration: 0.5 },
                    scale: {
                      duration: 0.6,
                      type: 'spring',
                      stiffness: 200,
                      damping: 20
                    },
                  }}
                  className="w-full px-1"
                >
                  {/* Input Form */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={onFileChange}
                    accept="image/*,video/*,audio/*"
                  />
                  <form onSubmit={handleSendMessage} className="relative group">
                    {/* Glass input container */}
                    <motion.div
                      className="relative rounded-2xl bg-white/10 backdrop-blur-2xl border border-white/20 shadow-lg overflow-hidden"
                      whileHover={{ scale: 1.01 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Reply Banner */}
                      <AnimatePresence>
                        {replyingTo && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="bg-white/5 border-b border-white/10 px-4 py-2 flex items-center justify-between"
                          >
                            <div className="flex flex-col text-xs text-white/80 w-full mr-2">
                              <span className="font-bold text-purple-300 mb-0.5">Replying to {replyingTo.sender === 'user' ? 'yourself' : 'Stranger'}</span>
                              {replyingTo.type === 'file' ? (
                                <div className="flex items-center gap-2">
                                  {replyingTo.fileType === 'image' ? (
                                    <img src={replyingTo.fileContent} alt="Reply preview" className="w-8 h-8 rounded object-cover" />
                                  ) : replyingTo.fileType === 'video' ? (
                                    <div className="w-8 h-8 rounded bg-white/10 flex items-center justify-center">
                                      <div className="w-0 h-0 border-t-4 border-t-transparent border-l-6 border-l-white border-b-4 border-b-transparent ml-0.5"></div>
                                    </div>
                                  ) : (
                                    <div className="w-8 h-8 rounded bg-white/10 flex items-center justify-center">
                                      <Mic className="w-4 h-4 opacity-70" />
                                    </div>
                                  )}
                                  <span className="truncate opacity-70">{replyingTo.text}</span>
                                </div>
                              ) : (
                                <span className="truncate opacity-70">{replyingTo.text}</span>
                              )}
                            </div>
                            <button onClick={cancelReply} className="p-1 hover:bg-white/10 rounded-full">
                              <X className="w-3 h-3 text-white/60" />
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      {/* Shimmer effect */}
                      <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                        animate={{
                          x: ['-100%', '100%'],
                        }}
                        transition={{
                          duration: 3,
                          repeat: Infinity,
                          repeatDelay: 2,
                          ease: 'easeInOut',
                        }}
                      />

                      <div className="relative flex items-center px-2 md:px-4 py-2 md:py-3">
                        {/* File Input Button */}
                        <motion.button
                          type="button"
                          onClick={handleFileSelect}
                          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          <Paperclip className="w-4 h-4 md:w-5 md:h-5 text-white/70" />
                        </motion.button>

                        {/* Emoji Button - Hidden on very small screens if needed, but keeping for now */}
                        <motion.button
                          type="button"
                          onClick={handleEmojiClick}
                          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors ml-0.5 md:ml-1"
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          <Smile className="w-4 h-4 md:w-5 md:h-5 text-white/70" />
                        </motion.button>

                        {/* Input */}
                        <input
                          type="text"
                          placeholder={isRecording ? "Recording..." : "Message..."}
                          value={message}
                          onChange={handleInputChange}
                          className="flex-1 bg-transparent text-white text-sm md:text-base placeholder-white/50 outline-none ml-2 md:ml-3 min-w-0"
                          autoFocus={!isLoading}
                          disabled={isRecording}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                        />

                        {/* Mic / Stop Button */}
                        <motion.button
                          type="button"
                          onClick={isRecording ? stopRecording : startRecording}
                          className={`p-1.5 rounded-lg ml-1 md:ml-2 transition-all ${isRecording ? 'bg-red-500/50 hover:bg-red-500/70 animate-pulse' : 'hover:bg-white/10'}`}
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                        >
                          {isRecording ? <StopCircle className="w-4 h-4 md:w-5 md:h-5 text-white" /> : <Mic className="w-4 h-4 md:w-5 md:h-5 text-white/70" />}
                        </motion.button>

                        {/* Send Button */}
                        <motion.button
                          type="submit"
                          className={`p-1.5 rounded-lg ml-2 transition-all ${!isChatActive || (!message.trim() && !isRecording) ? 'bg-gray-500/50 cursor-not-allowed' : 'bg-gradient-to-br from-purple-500/50 to-pink-500/50 hover:from-purple-500/70 hover:to-pink-500/70'}`}
                          whileHover={isChatActive && (message.trim() || isRecording) ? { scale: 1.1 } : {}}
                          whileTap={isChatActive && (message.trim() || isRecording) ? { scale: 0.9 } : {}}
                          disabled={!isChatActive || (!message.trim() && !isRecording)}
                        >
                          <Send className="w-4 h-4 text-white" />
                        </motion.button>
                      </div>
                    </motion.div>

                    {/* Session Ended Overlay */}
                    {!isChatActive && !isLoading && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute bottom-full left-0 right-0 mb-4 flex justify-end gap-3"
                      >
                        <button
                          type="button"
                          onClick={handleNext}
                          className="px-4 py-2 bg-white/10 backdrop-blur-xl border border-white/20 rounded-xl text-white hover:bg-white/20 transition-colors flex items-center gap-2"
                        >
                          <SkipForward className="w-4 h-4" /> New Chat
                        </button>
                        <button
                          type="button"
                          onClick={() => setView('home')}
                          className="px-4 py-2 bg-white/10 backdrop-blur-xl border border-white/20 rounded-xl text-white hover:bg-white/20 transition-colors flex items-center gap-2"
                        >
                          <LogOut className="w-4 h-4" /> Home
                        </button>
                      </motion.div>
                    )}

                    {/* Glow effect on hover */}
                    <motion.div
                      className="absolute -inset-[1px] rounded-2xl bg-gradient-to-r from-purple-500/50 via-pink-500/50 to-cyan-500/50 -z-10 blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    />
                  </form>
                </motion.div>

                {/* Esc Modal */}
                <AnimatePresence>
                  {showEscModal && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 z-50 flex items-center justify-center"
                      onClick={() => setShowEscModal(false)}
                    >
                      <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="bg-gray-900/90 border border-white/10 p-6 rounded-2xl shadow-2xl w-80 flex flex-col gap-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <h3 className="text-white text-lg font-medium mb-2 text-center">Options</h3>

                        <button
                          onClick={handleNext}
                          className="flex items-center gap-3 w-full p-3 rounded-xl bg-white/5 hover:bg-white/10 text-white transition-colors"
                        >
                          <SkipForward className="w-5 h-5 text-blue-400" />
                          <span>Find Next Stranger</span>
                          <span className="ml-auto text-xs text-white/40 border border-white/20 px-1.5 py-0.5 rounded">Esc</span>
                        </button>

                        <button
                          onClick={handleQuit}
                          className="flex items-center gap-3 w-full p-3 rounded-xl bg-white/5 hover:bg-red-500/20 text-red-400 transition-colors"
                        >
                          <LogOut className="w-5 h-5" />
                          <span>Quit Chat</span>
                        </button>

                        <button
                          onClick={() => setShowEscModal(false)}
                          className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-white/5 text-white/60 transition-colors justify-center mt-2"
                        >
                          Cancel
                        </button>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Media Preview Modal */}
                <AnimatePresence>
                  {previewMedia && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                      onClick={() => setPreviewMedia(null)}
                    >
                      <button
                        className="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20 text-white"
                        onClick={() => setPreviewMedia(null)}
                      >
                        <X className="w-6 h-6" />
                      </button>
                      {previewMedia.type === 'image' ? (
                        <img
                          src={previewMedia.url}
                          alt="Preview"
                          className="max-w-full max-h-full object-contain rounded-lg"
                        />
                      ) : (
                        <video
                          src={previewMedia.url}
                          controls
                          autoPlay
                          className="max-w-full max-h-full rounded-lg"
                        />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}