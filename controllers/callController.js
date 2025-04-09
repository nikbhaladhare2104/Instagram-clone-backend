const Call = require('../models/callModel');
const User = require('../models/userModel');


const axios = require('axios');

const SIGHTENGINE_API_USER = process.env.SIGHTENGINE_API_USER;
const SIGHTENGINE_API_SECRET = process.env.SIGHTENGINE_API_SECRET;
const SIGHTENGINE_URL = process.env.SIGHTENGINE_URL;
const ASSEMBLY_AI_API_KEY = process.env.ASSEMBLY_AI_API_KEY;
const ASSEMBLY_AI_URL = process.env.ASSEMBLY_AI_URL;
const SIGHTENGINE_URL_FOR_AUDIO_MODERATION = process.env.SIGHTENGINE_URL_FOR_AUDIO_MODERATION



const createCall = async(req,res)=>{
    // #swagger.tags=['Calls']
    try{
        const hostId = req.user.userId;
        const { participantId, roomName, callType } = req.body;

        if(!participantId || !roomName || !callType){
            return res.status(400).json({
                success:false,
                message:"Missing fields requires"
            })
        }

        if(hostId == participantId ){
            return res.status(401).json({message:"You cannot create your owncall"})
        }

        const newCall = await  Call.create({
            host:hostId,
            participantId,
            roomName,
            callType
        })

        await res.status(200).json({
            success:true,
            message:"Call create successfully",
            data:newCall
        })

    }catch(error){
        return res.status(500).json({
            success:false,
            message:"Internal server error",
            error:error.message
        })
    }
}


const acceptCall = async(req,res)=>{ 
    // #swagger.tags=['Calls']
    try{
        const participantId  = req.user.userId;
        const { roomName } = req.body;
        
        const call = await Call.findOne({ participantId, roomName });
        if(!call){
            return res.status(404).json({
                success:false,
                message:"Call not found or unauthorized"
            })
        }

        if(["missed", "completed", "rejected"].includes(call.status)){
            return res.status(400).json({
                success:false,
                message:`Call cannot be accepted. Current status: ${call.status}`
            })
        }

        if(call.status ==="ongoing"){
            return res.status(400).json({
                success:false,
                message:"Call status is already accepted"
            })
        }

        call.status ="ongoing";
        call.startedAt = new Date();
        await call.save();

        return res.status(200).json({
            success:true,
            message:"Call accepted successfully",
            data:call
        })


    }catch(error){
        return res.status(500).json({
            success:false,
            message:"Internal server error",
            error:error.message
        })
    }
}

const rejectCall = async(req,res)=>{
    // #swagger.tags=['Calls']
    try{
        const participantId = req.user.userId;
        const { roomName } = req.body;
    
        const call = await Call.findOne({ participantId, roomName });
        if(!call){
            return res.status(400).json({
                success:false,
                message:"Call not found or unauthorized",
            })
        }

        if(["missed", "completed", "ongoing"].includes(call.status)){
            return res.status(400).json({
                success:false,
                message:`Call cannot be rejected. Current status: ${call.status}`
            })
        }

        if(call.status === "rejected"){
            return res.status(400).json({
                success:false,
                message:"Call is already rejected"
            })
        }

        call.status="rejected"
        await call.save();

        return res.status(200).json({
            success:true,
            message:"Call rejected successfully",
            data:call
        })

    }catch(error){
        return res.status(500).json({
            success:false,
            message:"Internal server error",
            error:error.message
        })
    }
}


const endCall = async(req,res)=>{
    // #swagger.tags=['Calls']
    try{
        const userId = req.user.userId;
        const { roomName } = req.body;

        const call = await Call.findOne({ roomName,
            $or:[
                {host: userId},
                {participantId: userId}
            ]
        })

        if(!call){
            return res.status(404).json({
                success:false,
                message:"Call not found or unauthorized"
            })
        }

        if(call.status === "ringing" && String(call.host) == userId){
            call.status="missed";
        }else if (call.status !=="ongoing"){
            return res.status(400).json({
                success:false,
                message:"call is not ongoing"
            });
        }else{
            call.status ="completed";
        }

        call.endedAt = new Date();


        if(call.startedAt){
            const durationInMs = new Date(call.endedAt) - new Date(call.startedAt);
            call.duration = Math.floor(durationInMs/1000);  // duration in seconds only
            
        }

        await call.save();

        return res.status(200).json({
            success:true,
            message:"Call ended successfully",
            data:call
        })


    }catch(error){
        return res.status(500).json({
            success:false,
            message:"Internal server error",
            error:error.message
        })
    }
}



const videoModeration = async (req, res) => {
  // #swagger.tags=['Calls']
  try {
    const { roomName, callType, imageUrl } = req.body;

    if (!roomName || !callType || !imageUrl) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (callType !== 'video') {
      return res.status(400).json({ message: 'Invalid call type' });
    }

    // Sightengine API credentials
    const response = await axios.get(SIGHTENGINE_URL, {
      params: {
        url: imageUrl,
        models: 'nudity,wad,offensive',
        api_user: SIGHTENGINE_API_USER,
        api_secret: SIGHTENGINE_API_SECRET,
      },
    });

    const data = response.data;

    // Moderation logic with thresholds
    const isSafe =
      data.nudity.safe > 0.85 &&
      data.weapon < 0.2 &&
      data.alcohol < 0.2 &&
      data.drugs < 0.2;

    if (isSafe) {
      return res.status(200).json({
        message: 'Image is safe',
        status: 'approved',
        roomName,
      });
    } else {
      return res.status(403).json({
        message: 'Inappropriate content detected',
        status: 'rejected',
        roomName,
        issues: data,
      });
    }
  } catch (error) {
    console.error('Moderation Error:', error?.response?.data || error.message);
    res.status(500).json({ message: 'Moderation service error' });
  }
};





// 🔁 Convert audio URL to spoken text using AssemblyAI
const convertAudioToText = async (audioUrl) => {
      // Step 1: Send URL for transcription
    const transcribeRes = await axios.post(ASSEMBLY_AI_URL, {
      audio_url: audioUrl,
    }, {
      headers: {
        authorization: ASSEMBLY_AI_API_KEY,
        'content-type': 'application/json',
      },
    });
  
    const transcriptId = transcribeRes.data.id;
  
    // Step 2: Poll the transcript status until completed
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

    console.log('📝 Transcript:', transcriptText);
  
    return transcriptText;
  };
  


  const audioModeration = async (req, res) => {
    // #swagger.tags=['Calls']
    try {
      const { roomName, callType, audioUrl } = req.body;
  
      if (!roomName || !callType || !audioUrl) {
        return res.status(400).json({ message: 'All fields are required' });
      }
  
      if (callType !== 'voice') {
        return res.status(400).json({ message: 'Invalid call type' });
      }
  
      // Step 1: Convert audio to text
      const transcribedText = await convertAudioToText(audioUrl);

       // ✅ Reject empty transcriptions
    if (!transcribedText || transcribedText.trim().length === 0) {
        return res.status(400).json({
          message: 'No clear speech detected in the audio. Try uploading again with clear voice.',
          status: 'rejected',
          roomName,
          audioSpokenText: transcribedText,
          transcript: transcribedText,
        });
      }
  
      // Step 2: Send transcribed text to Sightengine
      const moderationResponse = await axios.get(SIGHTENGINE_URL_FOR_AUDIO_MODERATION, {
        params: {
          text: transcribedText,
          mode: 'standard',
          lang: 'en',
          api_user: SIGHTENGINE_API_USER,
          api_secret: SIGHTENGINE_API_SECRET,
        },
      });
  
      const moderationData = moderationResponse.data;
  
      const isSafe = moderationData.profanity.matches.length === 0;
  
      if (isSafe) {
        return res.status(200).json({
          message: 'Audio is safe',
          status: 'approved',
          roomName,
          audioSpokenText:transcribedText,
          transcript: transcribedText,
        
        });
      } else {
        return res.status(403).json({
          message: 'Inappropriate content detected in audio',
          status: 'rejected',
          roomName,
          audioSpokenText:transcribedText,
          transcript: transcribedText,
          issues: moderationData,
        });
      }
    } catch (error) {
      console.error('Audio Moderation Error:', error?.response?.data || error.message);
      res.status(500).json({ message: 'Moderation service error' });
    }
  };


module.exports = { createCall, acceptCall, rejectCall, endCall, videoModeration, audioModeration }