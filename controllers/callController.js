const axios = require('axios');
const Call = require('../models/callModel');
const { handleError } = require('../utils/errorHandler'); // Reusable error handler

const SIGHTENGINE_API_USER = process.env.SIGHTENGINE_API_USER;
const SIGHTENGINE_API_SECRET = process.env.SIGHTENGINE_API_SECRET;
const SIGHTENGINE_URL = process.env.SIGHTENGINE_URL;
const ASSEMBLY_AI_API_KEY = process.env.ASSEMBLY_AI_API_KEY;
const ASSEMBLY_AI_URL = process.env.ASSEMBLY_AI_URL;
const SIGHTENGINE_URL_FOR_AUDIO_MODERATION = process.env.SIGHTENGINE_URL_FOR_AUDIO_MODERATION;

// Helper function for creating a call
const createNewCall = async (hostId, { participantId, roomName, callType }) => {
  if (hostId === participantId) throw new Error("You cannot create your own call");
  const newCall = await Call.create({ host: hostId, participantId, roomName, callType });
  return newCall;
};

// Handler for creating a call
const createCall = async (req, res) => {
  try {
    const hostId = req.user.userId;
    const { participantId, roomName, callType } = req.body;

    if (!participantId || !roomName || !callType) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const newCall = await createNewCall(hostId, { participantId, roomName, callType });
    return res.status(200).json({ success: true, message: "Call created successfully", data: newCall });
  } catch (error) {
    return handleError(res, error);
  }
};

// Handler for accepting a call
const acceptCall = async (req, res) => {
  try {
    const participantId = req.user.userId;
    const { roomName } = req.body;

    const call = await Call.findOne({ participantId, roomName });
    if (!call || ["missed", "completed", "rejected"].includes(call.status)) {
      return res.status(400).json({ success: false, message: "Cannot accept call with this status" });
    }

    call.status = "ongoing";
    call.startedAt = new Date();
    await call.save();
    return res.status(200).json({ success: true, message: "Call accepted", data: call });
  } catch (error) {
    return handleError(res, error);
  }
};

// Handler for rejecting a call
const rejectCall = async (req, res) => {
  try {
    const participantId = req.user.userId;
    const { roomName } = req.body;

    const call = await Call.findOne({ participantId, roomName });
    if (!call || ["missed", "completed", "ongoing"].includes(call.status)) {
      return res.status(400).json({ success: false, message: "Cannot reject call with this status" });
    }

    call.status = "rejected";
    await call.save();
    return res.status(200).json({ success: true, message: "Call rejected", data: call });
  } catch (error) {
    return handleError(res, error);
  }
};

// Handler for ending a call
const endCall = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { roomName } = req.body;

    const call = await Call.findOne({ roomName, $or: [{ host: userId }, { participantId: userId }] });
    if (!call) {
      return res.status(404).json({ success: false, message: "Call not found or unauthorized" });
    }

    if (call.status === "ringing" && String(call.host) === userId) {
      call.status = "missed";
    } else if (call.status !== "ongoing") {
      return res.status(400).json({ success: false, message: "Call is not ongoing" });
    } else {
      call.status = "completed";
    }

    call.endedAt = new Date();
    if (call.startedAt) {
      const durationInMs = new Date(call.endedAt) - new Date(call.startedAt);
      call.duration = Math.floor(durationInMs / 1000);
    }

    await call.save();
    return res.status(200).json({ success: true, message: "Call ended successfully", data: call });
  } catch (error) {
    return handleError(res, error);
  }
};

// Helper function to handle image moderation
const moderateImage = async (imageUrl) => {
  const response = await axios.get(SIGHTENGINE_URL, {
    params: {
      url: imageUrl,
      models: 'nudity,wad,offensive',
      api_user: SIGHTENGINE_API_USER,
      api_secret: SIGHTENGINE_API_SECRET,
    },
  });
  return response.data;
};

// Video moderation handler
const videoModeration = async (req, res) => {
  try {
    const { roomName, callType, imageUrl } = req.body;

    if (!roomName || !callType || !imageUrl) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (callType !== 'video') {
      return res.status(400).json({ message: 'Invalid call type' });
    }

    const data = await moderateImage(imageUrl);

    const isSafe = data.nudity.safe > 0.85 && data.weapon < 0.2 && data.alcohol < 0.2 && data.drugs < 0.2;

    if (isSafe) {
      return res.status(200).json({ message: 'Image is safe', status: 'approved', roomName });
    } else {
      return res.status(403).json({
        message: 'Inappropriate content detected',
        status: 'rejected',
        roomName,
        issues: data,
      });
    }
  } catch (error) {
    return handleError(res, error, "Moderation service error");
  }
};

// Helper function to convert audio to text
const convertAudioToText = async (audioUrl) => {
  const transcribeRes = await axios.post(ASSEMBLY_AI_URL, { audio_url: audioUrl }, {
    headers: { authorization: ASSEMBLY_AI_API_KEY, 'content-type': 'application/json' },
  });
  const transcriptId = transcribeRes.data.id;

  let status = 'processing';
  let transcriptText = '';
  while (status !== 'completed') {
    const pollingRes = await axios.get(`${ASSEMBLY_AI_URL}/${transcriptId}`, {
      headers: { authorization: ASSEMBLY_AI_API_KEY },
    });
    status = pollingRes.data.status;
    if (status === 'completed') {
      transcriptText = pollingRes.data.text;
    } else if (status === 'error') {
      throw new Error(pollingRes.data.error || 'Transcription failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return transcriptText;
};

// Audio moderation handler
const audioModeration = async (req, res) => {
  try {
    const { roomName, callType, audioUrl } = req.body;

    if (!roomName || !callType || !audioUrl) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (callType !== 'voice') {
      return res.status(400).json({ message: 'Invalid call type' });
    }

    const transcribedText = await convertAudioToText(audioUrl);

    if (!transcribedText || transcribedText.trim().length === 0) {
      return res.status(400).json({
        message: 'No clear speech detected. Try uploading with clearer voice.',
        status: 'rejected',
        roomName,
        audioSpokenText: transcribedText,
        transcript: transcribedText,
      });
    }

    const moderationResponse = await axios.get(SIGHTENGINE_URL_FOR_AUDIO_MODERATION, {
      params: {
        text: transcribedText,
        mode: 'standard',
        lang: 'en',
        api_user: SIGHTENGINE_API_USER,
        api_secret: SIGHTENGINE_API_SECRET,
      },
    });

    const isSafe = moderationResponse.data.profanity.matches.length === 0;

    if (isSafe) {
      return res.status(200).json({
        message: 'Audio is safe',
        status: 'approved',
        roomName,
        audioSpokenText: transcribedText,
        transcript: transcribedText,
      });
    } else {
      return res.status(403).json({
        message: 'Inappropriate content detected in audio',
        status: 'rejected',
        roomName,
        audioSpokenText: transcribedText,
        transcript: transcribedText,
        issues: moderationResponse.data,
      });
    }
  } catch (error) {
    return handleError(res, error, "Audio moderation service error");
  }
};

module.exports = { createCall, acceptCall, rejectCall, endCall, videoModeration, audioModeration };
