/*
 * Simple Web3 wallet tracker backend
 *
 * This server exposes a tiny REST API for retrieving wallet balances and
 * transaction history across several popular blockchains. It is designed to
 * run without third‑party modules like express; instead it uses Node's
 * built‑in http module. To support cross‑origin requests the server
 * automatically adds CORS headers to every response. It also supports
 * optional integration with the Covalent unified API for richer token
 * balances and transaction details if you supply an API key via the
 * `COVALENT_API_KEY` environment variable in an `.env` file. When no
 * Covalent API key is present the server falls back to querying each
 * blockchain's public RPC endpoint for the native currency balance and
 * uses CoinGecko to resolve the corresponding USD price.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// -----------------------------------------------------------------------------
// Environment handling
//
// This lightweight environment loader reads key=value pairs from a `.env`
// file in the same directory as this script and populates process.env. The
// loader intentionally ignores commented lines and blank lines. If the
// `.env` file does not exist the loader silently succeeds.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envLines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of envLines) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([^=\s]+)\s*=\s*(.*)\s*$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

// -----------------------------------------------------------------------------
// Blockchain configuration
//
// Each supported network is described by a chainId (used by the now‑optional
// Covalent integration), the corresponding public RPC endpoint, and the
// identifier used by Moralis when querying their Web3 Data API. The
// nativeSymbol is used both for display and to resolve pricing information via
// CoinGecko. If new networks should be added in the future simply extend
// this object with appropriate chain identifiers.
const CHAIN_INFO = {
  ethereum: {
    // Covalent chain ID for backwards compatibility
    chainId: 1,
    // RPC endpoint for raw JSON‑RPC requests
    rpc: 'https://cloudflare-eth.com',
    // Human‑readable symbol for the native token
    nativeSymbol: 'ETH',
    // CoinGecko identifier used to fetch USD price
    coinGeckoId: 'ethereum',
    // Moralis chain slug used in API requests
    moralisChain: 'eth',
  },
  polygon: {
    chainId: 137,
    rpc: 'https://polygon-rpc.com',
    nativeSymbol: 'MATIC',
    coinGeckoId: 'polygon',
    moralisChain: 'polygon',
  },
  binance: {
    chainId: 56,
    rpc: 'https://bsc-dataseed.binance.org',
    nativeSymbol: 'BNB',
    coinGeckoId: 'binancecoin',
    moralisChain: 'bsc',
  },
  base: {
    chainId: 8453,
    rpc: 'https://mainnet.base.org',
    nativeSymbol: 'ETH',
    coinGeckoId: 'ethereum',
    moralisChain: 'base',
  },
  solana: {
    // Solana does not use numeric chain IDs in Covalent or Moralis
    chainId: 'solana',
    rpc: 'https://api.mainnet-beta.solana.com',
    nativeSymbol: 'SOL',
    coinGeckoId: 'solana',
    moralisChain: 'solana',
  },
};

// -----------------------------------------------------------------------------
// Helper functions
//
// Perform a JSON‑RPC request against an EVM compatible endpoint. Returns the
// parsed JSON response. Any non‑200 HTTP response is thrown as an error.
async function jsonRpcRequest(endpoint, payload) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`RPC request failed with status ${response.status}`);
  }
  return response.json();
}

// Fetch the native balance of an EVM address. Returns the floating point
// balance denominated in the native token (e.g. ETH for Ethereum). If the
// request fails the function returns null.
async function getEvmNativeBalance(rpc, address) {
  try {
    const data = await jsonRpcRequest(rpc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    });
    const hex = data.result;
    if (!hex) return null;
    const wei = BigInt(hex);
    // Convert from wei to ether (1e18)
    const balance = Number(wei) / 1e18;
    return balance;
  } catch (err) {
    console.error('EVM balance fetch failed:', err);
    return null;
  }
}

// Fetch the SOL balance of a Solana address. Returns the SOL balance in units
// of SOL (1 SOL = 1e9 lamports). If the request fails returns null.
async function getSolanaBalance(rpc, address) {
  try {
    const response = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [address],
      }),
    });
    if (!response.ok) throw new Error(`Solana RPC status ${response.status}`);
    const json = await response.json();
    const lamports = json?.result?.value;
    if (lamports == null) return null;
    return lamports / 1e9;
  } catch (err) {
    console.error('Solana balance fetch failed:', err);
    return null;
  }
}

// Retrieve token balances and portfolio value using the Covalent unified API.
// Returns an object with a `tokens` array and `portfolioValueUsd` number. If
// the API key is missing or the request fails, returns null. Only EVM
// compatible networks are supported by Covalent; Solana will always return
// null.
async function getCovalentBalances(chainId, address, apiKey) {
  if (!apiKey) return null;
  try {
    const url =
      `https://api.covalenthq.com/v1/${chainId}/address/${address}/balances_v2/?quote-currency=USD&format=JSON&nft=false&no-nft-fetch=true&key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Covalent balances API status', response.status);
      return null;
    }
    const json = await response.json();
    const items = json?.data?.items || [];
    let portfolioValueUsd = 0;
    const tokens = items
      .filter((item) => {
        // Skip tokens with zero balance
        return item.balance !== '0' && item.quote !== 0;
      })
      .map((item) => {
        const balanceRaw = BigInt(item.balance || '0');
        const decimals = item.contract_decimals || 0;
        const balance = Number(balanceRaw) / 10 ** decimals;
        const value = item.quote || 0;
        portfolioValueUsd += value;
        return {
          contractName: item.contract_name,
          symbol: item.contract_ticker_symbol,
          balance,
          decimals,
          quote: value,
        };
      });
    return { tokens, portfolioValueUsd };
  } catch (err) {
    console.error('Covalent balances fetch failed:', err);
    return null;
  }
}

// Retrieve transaction history using Covalent. Only EVM networks are
// supported; Solana returns null. The function returns an array of
// transaction objects with a few key fields. Covalent's v3 API is used,
// paginating the first page (100 transactions). If the API key is missing
// or the request fails the function returns null.
async function getCovalentTransactions(chainId, address, apiKey) {
  if (!apiKey) return null;
  try {
    // We request the first page of v3 transactions. Each page contains up to 100 entries.
    const url =
      `https://api.covalenthq.com/v1/${chainId}/address/${address}/transactions_v3/page/0/?quote-currency=USD&format=JSON&key=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Covalent transactions API status', response.status);
      return null;
    }
    const json = await response.json();
    const items = json?.data?.items || [];
    // Map the transactions into a simplified representation
    const txs = items.map((tx) => {
      return {
        txHash: tx.tx_hash,
        from: tx.from_address,
        to: tx.to_address,
        value: tx.value,
        valueQuote: tx.value_quote,
        gasSpent: tx.gas_spent,
        gasQuote: tx.gas_quote,
        successful: tx.successful,
        timestamp: tx.block_signed_at,
      };
    });
    return txs;
  } catch (err) {
    console.error('Covalent transactions fetch failed:', err);
    return null;
  }
}

// Fetch transaction signatures for Solana. This returns an array of
// signature objects including the slot and optional timestamp. We limit
// ourselves to the most recent 20 signatures. If the request fails the
// function returns null.
async function getSolanaSignatures(rpc, address) {
  try {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getSignaturesForAddress',
      params: [address, { limit: 20 }],
    };
    const response = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Solana signatures status ${response.status}`);
    const json = await response.json();
    return json?.result || [];
  } catch (err) {
    console.error('Solana signature fetch failed:', err);
    return null;
  }
}

// Lookup USD price for the native token of a network using CoinGecko's
// `simple/price` endpoint. Returns a numeric price or null on error.
async function getNativePriceUsd(coinGeckoId) {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinGeckoId}&vs_currencies=usd`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`CoinGecko status ${response.status}`);
    const json = await response.json();
    const price = json?.[coinGeckoId]?.usd;
    return price != null ? Number(price) : null;
  } catch (err) {
    console.error('Native price fetch failed:', err);
    return null;
  }
}

// -----------------------------------------------------------------------------
// Moralis integration
//
// Moralis provides a unified Web3 Data API across many chains. The functions
// below wrap the key endpoints needed for a wallet tracker: balances and
// transaction history. Each request requires an `X-API-Key` header containing
// your Moralis API key. These helpers gracefully handle errors and return
// simplified structures.

/**
 * Fetch token balances and portfolio value from Moralis.
 *
 * @param {string} chainSlug  The Moralis chain identifier (e.g. 'eth', 'polygon').
 * @param {string} address    Wallet address to query.
 * @param {string} apiKey     Moralis API key.
 * @returns {Promise<{tokens: Array<{contractName:string,symbol:string,balance:number,decimals:number,quote:number,nativeToken:boolean}>, portfolioValueUsd:number}>|null}
 */
async function getMoralisBalances(chainSlug, address, apiKey) {
  if (!apiKey) return null;
  try {
    const url = `https://deep-index.moralis.io/api/v2.2/wallets/${address}/tokens?chain=${chainSlug}&exclude_spam=true&currency=usd`;
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'X-API-Key': apiKey,
      },
    });
    if (!response.ok) {
      console.error('Moralis balances API status', response.status);
      return null;
    }
    const json = await response.json();
    const items = json?.result || [];
    // We'll accumulate the USD value of non‑native tokens only; the native token value
    // is returned separately via nativeFromMoralis to avoid double counting.
    let portfolioValueUsd = 0;
    let nativeFromMoralis = null;
    const tokens = [];
    for (const item of items) {
      // Skip items with zero balance
      if (item.balance === '0') continue;
      const decimals = Number(item.decimals || 0);
      let balance = 0;
      try {
        const bn = BigInt(item.balance || '0');
        balance = Number(bn) / 10 ** decimals;
      } catch (e) {
        balance = parseFloat(item.balance || '0');
      }
      const usdValue = item.usd_value ? Number(item.usd_value) : 0;
      if (item.native_token) {
        // Save native token info separately
        nativeFromMoralis = { balance, usd: usdValue };
      } else {
        portfolioValueUsd += usdValue;
        tokens.push({
          contractName: item.name || item.token_address || '',
          symbol: item.symbol || '',
          balance,
          decimals,
          quote: usdValue,
          nativeToken: false,
        });
      }
    }
    return { tokens, portfolioValueUsd, nativeFromMoralis };
  } catch (err) {
    console.error('Moralis balances fetch failed:', err);
    return null;
  }
}

/**
 * Fetch transaction history from Moralis.
 *
 * @param {string} chainSlug  The Moralis chain identifier (e.g. 'eth', 'polygon').
 * @param {string} address    Wallet address to query.
 * @param {string} apiKey     Moralis API key.
 * @returns {Promise<Array<{txHash:string,from:string,to:string,value:number,valueQuote:number,timestamp:string,successful:boolean}>|null>}
 */
async function getMoralisTransactions(chainSlug, address, apiKey) {
  if (!apiKey) return null;
  try {
    const url = `https://deep-index.moralis.io/api/v2.2/wallets/${address}/history?chain=${chainSlug}&order=DESC&limit=50`;
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'X-API-Key': apiKey,
      },
    });
    if (!response.ok) {
      console.error('Moralis transactions API status', response.status);
      return null;
    }
    const json = await response.json();
    const items = json?.result || [];
    const txs = items.map((tx) => {
      // Some properties may not exist on all chains; use fallbacks
      const value = tx.value ? Number(tx.value) : 0;
      const valueUsd = tx.value_usd ? Number(tx.value_usd) : null;
      return {
        txHash: tx.hash || tx.transaction_hash || '',
        from: tx.from_address || tx.from || '',
        to: tx.to_address || tx.to || '',
        value,
        valueQuote: valueUsd,
        timestamp: tx.block_timestamp || tx.block_signed_at || '',
        successful: tx.receipt_status !== undefined ? Boolean(tx.receipt_status) : true,
      };
    });
    return txs;
  } catch (err) {
    console.error('Moralis transactions fetch failed:', err);
    return null;
  }
}
// -----------------------------------------------------------------------------
// Request routing
//
// The handler inspects the request pathname and query string to determine
// which function to invoke. When serving static files the appropriate
// `Content-Type` header is set based on the file extension. Unknown paths
// yield a 404 response. All responses include a permissive CORS header.
async function handleRequest(req, res) {
  // Ensure CORS is allowed for all origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Preflight for CORS
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;
  try {
    if (pathname === '/api/balances' && req.method === 'GET') {
      const network = urlObj.searchParams.get('network');
      const address = urlObj.searchParams.get('address');
      if (!network || !address || !CHAIN_INFO[network]) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing or invalid network/address' }));
        return;
      }
      const chain = CHAIN_INFO[network];
      let nativeBalance = null;
      let tokenData = null;
      let moralisNative = null;
      // Determine how to fetch balances based on network type
      if (network === 'solana') {
        // Solana uses direct RPC for native balance; Moralis integration for Solana
        nativeBalance = await getSolanaBalance(chain.rpc, address);
        // Attempt to use Moralis for token balances if an API key is supplied; this may
        // return SPL tokens and SOL as part of the result. If Moralis is unavailable
        // the tokenData will remain null.
        if (process.env.MORALIS_API_KEY) {
          tokenData = await getMoralisBalances(chain.moralisChain, address, process.env.MORALIS_API_KEY);
          if (tokenData && tokenData.nativeFromMoralis) {
            moralisNative = tokenData.nativeFromMoralis;
          }
        }
      } else {
        // EVM native balance via RPC
        nativeBalance = await getEvmNativeBalance(chain.rpc, address);
        // Prefer Moralis for token balances and portfolio value if API key exists
        if (process.env.MORALIS_API_KEY) {
          tokenData = await getMoralisBalances(chain.moralisChain, address, process.env.MORALIS_API_KEY);
          if (tokenData && tokenData.nativeFromMoralis) {
            moralisNative = tokenData.nativeFromMoralis;
          }
        } else if (process.env.COVALENT_API_KEY) {
          // Fallback to Covalent if Moralis is not configured
          tokenData = await getCovalentBalances(chain.chainId, address, process.env.COVALENT_API_KEY);
        }
      }
      // Resolve USD price for native balance via CoinGecko
      const priceUsd = await getNativePriceUsd(chain.coinGeckoId);
      let nativeValueUsd = null;
      if (nativeBalance != null && priceUsd != null) {
        nativeValueUsd = nativeBalance * priceUsd;
      }
      // Compose response object. If tokenData is provided, separate native tokens
      // from ERC20s/SPLs to avoid double counting.
      let tokenBalances = null;
      let tokenPortfolioValueUsd = null;
      if (tokenData) {
        // Filter out the native token from the tokens list if present
        tokenBalances = tokenData.tokens;
        tokenPortfolioValueUsd = tokenData.portfolioValueUsd;
      }
      // If the RPC native balance failed but Moralis returned a native balance, use it
      if ((nativeBalance == null || isNaN(nativeBalance)) && moralisNative) {
        nativeBalance = moralisNative.balance;
      }
      // Similarly, compute native USD value from Moralis if our price lookup failed
      if (nativeValueUsd == null && moralisNative && moralisNative.usd != null) {
        nativeValueUsd = moralisNative.usd;
      }
      const responseBody = {
        network,
        address,
        nativeBalance,
        nativeSymbol: chain.nativeSymbol,
        nativeValueUsd,
        tokenBalances,
        tokenPortfolioValueUsd,
      };
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(responseBody));
      return;
    }
    if (pathname === '/api/transactions' && req.method === 'GET') {
      const network = urlObj.searchParams.get('network');
      const address = urlObj.searchParams.get('address');
      if (!network || !address || !CHAIN_INFO[network]) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing or invalid network/address' }));
        return;
      }
      const chain = CHAIN_INFO[network];
      let txs = null;
      if (network === 'solana') {
        // Use Solana RPC for getting recent signatures; Moralis may not support Solana history
        txs = await getSolanaSignatures(chain.rpc, address);
      } else {
        // Prefer Moralis for EVM transaction history if an API key is provided
        if (process.env.MORALIS_API_KEY) {
          txs = await getMoralisTransactions(chain.moralisChain, address, process.env.MORALIS_API_KEY);
        } else if (process.env.COVALENT_API_KEY) {
          // Fallback to Covalent if Moralis is not configured
          txs = await getCovalentTransactions(chain.chainId, address, process.env.COVALENT_API_KEY);
        } else {
          txs = null;
        }
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ network, address, transactions: txs }));
      return;
    }
    // Serve static files from the client directory
    let filePath = null;
    if (pathname === '/' || pathname === '/index.html') {
      filePath = path.join(__dirname, '../client/index.html');
    } else if (pathname.startsWith('/static/')) {
      // Map /static/ paths to client directory
      filePath = path.join(__dirname, '../client', pathname.replace('/static/', ''));
    } else if (pathname === '/style.css') {
      filePath = path.join(__dirname, '../client/style.css');
    } else if (pathname === '/script.js') {
      filePath = path.join(__dirname, '../client/script.js');
    }
    if (filePath && fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', mimeType);
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    // Unknown path
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not Found' }));
  } catch (err) {
    console.error('Error handling request:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

// Create and start the server
const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  handleRequest(req, res);
});
server.listen(port, () => {
  console.log(`Wallet tracker backend listening on port ${port}`);
});