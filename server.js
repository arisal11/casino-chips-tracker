require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const path = require('path');
const morgan = require('morgan');
const flash = require('connect-flash');

const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;

(async function connectDB(){
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/casino-chips');
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error', err);
    process.exit(1);
  }
})();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('dev'));
app.use(flash());

app.use(session({
  secret: process.env.SESSION_SECRET || 'devsecret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/casino-chips' }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

// simple middleware to expose user to views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.messages = req.flash();
  next();
});

// ---------- Auth helpers ----------
function requireAuth(req, res, next){
  if (!req.session.user) {
    req.flash('error', 'You must be logged in.');
    return res.redirect('/login');
  }
  next();
}

// ---------- Routes ----------
// Home redirect
app.get('/', (req, res) => res.redirect('/dashboard'));

// Signup
app.get('/signup', (req, res) => {
  res.render('signup');
});

app.post('/signup', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    req.flash('error', 'Name and password required');
    return res.redirect('/signup');
  }
  try {
    const existing = await User.findOne({ name });
    if (existing) {
      req.flash('error', 'Name already registered');
      return res.redirect('/signup');
    }
    const user = new User({ name, password, wallet: 250 });
    await user.save();
    req.session.user = { id: user._id, email: user.name };
    req.flash('success', 'Account created. $250 credited to your wallet!');
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Server error');
    res.redirect('/signup');
  }
});

// Login
app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  const { name, password } = req.body;
  const user = await User.findOne({ name });
  if (!user) {
    req.flash('error', 'Wrong credentials');
    return res.redirect('/login');
  }
  req.session.user = { id: user._id, name: user.name };
  res.redirect('/dashboard');
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(err => {
    res.redirect('/login');
  });
});

// Dashboard
app.get('/dashboard', requireAuth, async (req, res) => {
  const user = await User.findById(req.session.user.id).lean();
  if (!user) {
    req.flash('error', 'User not found');
    return res.redirect('/login');
  }

  // calculate per-game totals
  const games = ['poker','blackjack','roulette','ride-the-bus'];
  const totals = {};
  for (const g of games) {
    const gameEntries = (user.history || []).filter(h => h.game === g);
    const spent = gameEntries.filter(h => h.type === 'bet').reduce((s, e) => s + e.amount, 0);
    const won = gameEntries.filter(h => h.type === 'win').reduce((s, e) => s + e.amount, 0);
    totals[g] = { spent, won, net: won - spent };
  }
  const totalSpent = Object.values(totals).reduce((s, t) => s + t.spent, 0);
  const totalWon = Object.values(totals).reduce((s, t) => s + t.won, 0);

  res.render('dashboard', {
    wallet: user.wallet,
    totals,
    totalSpent,
    totalWon,
    history: (user.history || []).slice().reverse() // recent first
  });
});

// Place a bet (decrease wallet, add history)
app.post('/bet', requireAuth, async (req, res) => {
  try {
    const { game, amount } = req.body;
    const bet = Math.round(Number(amount) * 100) / 100;
    if (!['poker','blackjack','roulette','ride-the-bus'].includes(game)) {
      req.flash('error', 'Invalid game');
      return res.redirect('/dashboard');
    }
    if (!bet || bet <= 0) {
      req.flash('error', 'Invalid bet amount');
      return res.redirect('/dashboard');
    }

    const user = await User.findById(req.session.user.id);
    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/login');
    }
    if (user.wallet < bet) {
      req.flash('error', 'Not enough funds to place that bet');
      return res.redirect('/dashboard');
    }

    user.wallet = Math.round((user.wallet - bet) * 100) / 100;
    user.history.push({ game, amount: bet, type: 'bet' });
    await user.save();
    req.flash('success', `Placed $${bet.toFixed(2)} bet on ${game}`);
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Server error');
    res.redirect('/dashboard');
  }
});

// Record a win (increase wallet, add history)
app.post('/win', requireAuth, async (req, res) => {
  try {
    const { game, amount } = req.body;
    const win = Math.round(Number(amount) * 100) / 100;
    if (!['poker','blackjack','roulette','ride-the-bus'].includes(game)) {
      req.flash('error', 'Invalid game');
      return res.redirect('/dashboard');
    }
    if (!win || win <= 0) {
      req.flash('error', 'Invalid win amount');
      return res.redirect('/dashboard');
    }

    const user = await User.findById(req.session.user.id);
    if (!user) {
      req.flash('error', 'User not found');
      return res.redirect('/login');
    }

    user.wallet = Math.round((user.wallet + win) * 100) / 100;
    user.history.push({ game, amount: win, type: 'win' });
    await user.save();
    req.flash('success', `Recorded $${win.toFixed(2)} win on ${game}`);
    res.redirect('/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Server error');
    res.redirect('/dashboard');
  }
});

// Start
app.listen(PORT, () => {
  console.log(`Server running at ${PORT}`);
});
