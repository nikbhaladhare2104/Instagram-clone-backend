const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  host: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  participantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  roomName: {
    type: String,
    required: true,
    unique: true,
  },
  callType: {
    type: String,
    enum: ['voice', 'video'],
    required: true,
  },
  duration: {
    type: Number, // in seconds
    default: 0,
  },
  status: {
    type: String,
    enum: ['ringing','missed', 'rejected', 'completed', 'ongoing'],
    default: 'ringing',
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  endedAt: {
    type: Date,
  },
}, {
  timestamps: true, 
});

module.exports = mongoose.model('Call', callSchema);
