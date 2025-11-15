const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
  game: { type: String, enum: ['poker','blackjack','roulette','ride-the-bus'], required: true },
  amount: { type: Number, required: true }, // positive amounts
  type: { type: String, enum: ['bet','win'], required: true },
  date: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  wallet: { type: Number, default: 250 }, // start with $250
  history: [historySchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
