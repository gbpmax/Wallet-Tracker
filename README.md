# Wallet-Tracker
A lightweight, full-stack Web3 wallet tracker that lets you view balances and transaction history across multiple blockchains — Ethereum, Polygon, Binance Smart Chain, Base, and Solana — using public RPC endpoints or optional API integrations (Moralis / Covalent).


🚀 Features

🔍 Lookup any wallet address

🌐 Supports multi-chain tracking:

Ethereum

Polygon

Binance Smart Chain

Base

Solana

💰 Displays:

Native token balances and USD values

ERC20/SPL token portfolios

Recent transaction history

⚙️ Backend with Node.js HTTP server (no Express dependency)

🔓 CORS enabled for front-end access

🔑 Optional integration with:

Moralis Web3 Data API

Covalent Unified API

CoinGecko Price API

🧩 Project Structure
wallet-tracker/
├── client/
│   ├── index.html      # Frontend UI
│   ├── style.css       # Styling
│   └── script.js       # Client-side logic
├── server/
│   ├── index.js        # Node.js backend server
│   └── package.json    # Server package definition
└── .gitignore

⚙️ Installation & Setup
1. Clone the repo
git clone https://github.com/yourusername/wallet-tracker.git
cd wallet-tracker/server

2. Create an .env file (optional)

To enable richer data (token balances and transaction history), add API keys:

MORALIS_API_KEY=your_moralis_key_here
COVALENT_API_KEY=your_covalent_key_here
PORT=3000


You can still use the app without keys — it will fall back to public RPC and CoinGecko data.

3. Run the backend
node index.js


The backend will start on http://localhost:3000.

4. Open the frontend

Simply open client/index.html in your browser, or serve it via VSCode Live Server / a simple HTTP server.

Example:

npx serve ../client

🧠 How It Works

The frontend (HTML + JS) sends requests to:

/api/balances?network=ethereum&address=0x...

/api/transactions?network=polygon&address=0x...

The backend aggregates:

Native balances via RPC

Token balances & transactions via Moralis or Covalent (if keys exist)

Prices via CoinGecko

Returns JSON responses used to render balance tables and transaction cards.

🧰 Technologies Used

Frontend:

HTML5 / CSS3 / Vanilla JS

Responsive UI with simple flexbox design

Backend:

Node.js (no dependencies)

Native HTTP module

Fetch API for network requests

Optional Moralis / Covalent / CoinGecko integrations

📦 Example API Responses
/api/balances
{
  "network": "ethereum",
  "address": "0x123...",
  "nativeBalance": 0.82,
  "nativeSymbol": "ETH",
  "nativeValueUsd": 2500.23,
  "tokenBalances": [
    { "symbol": "USDC", "balance": 100.0, "quote": 100.0 }
  ],
  "tokenPortfolioValueUsd": 100.0
}

/api/transactions
{
  "network": "polygon",
  "transactions": [
    {
      "txHash": "0xabc...",
      "from": "0x123...",
      "to": "0x456...",
      "valueQuote": 10.5,
      "timestamp": "2025-10-06T12:00:00Z"
    }
  ]
}

🧪 Development Notes

Works entirely in your browser — no wallet connection or private key needed.

Written with clarity and zero dependencies for easy learning and modification.

You can deploy to:

Localhost

Render / Railway / Replit / Vercel (for static frontend + Node server)

🪙 Future Improvements

Token logo display using CoinGecko metadata

Wallet bookmarking

Aggregated portfolio view

CSV export for transactions

📝 License

This project is open source and available under the MIT License.
