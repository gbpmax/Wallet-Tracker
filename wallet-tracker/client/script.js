// script.js

// Utility functions
function truncateAddress(addr) {
  if (!addr) return '';
  return addr.length > 12
    ? `${addr.slice(0, 6)}…${addr.slice(-4)}`
    : addr;
}

// Mapping network name to explorer URLs. Used to build links for tx hashes.
const EXPLORERS = {
  ethereum: 'https://etherscan.io/tx/',
  polygon: 'https://polygonscan.com/tx/',
  binance: 'https://bscscan.com/tx/',
  base: 'https://basescan.org/tx/',
  solana: 'https://solscan.io/tx/',
};

// Format a number with thousand separators and up to four decimals. For small
// values we preserve precision. When value is null returns '–'.
function formatNumber(value) {
  if (value == null || isNaN(value)) return '–';
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

// Convert ISO timestamp string to a more readable date/time. If not present
// returns empty string.
function formatTimestamp(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  return date.toLocaleString();
}

// Handle form submission
document.getElementById('lookup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const addressInput = document.getElementById('address').value.trim();
  if (!addressInput) {
    alert('Please enter a wallet address');
    return;
  }
  // Collect selected networks
  const networkCheckboxes = document.querySelectorAll('input[name="network"]:checked');
  const networks = Array.from(networkCheckboxes).map((cb) => cb.value);
  if (networks.length === 0) {
    alert('Please select at least one network');
    return;
  }
  const resultsContainer = document.getElementById('results');
  // Clear previous results and show loading indicator
  resultsContainer.innerHTML = '<p>Loading…</p>';
  try {
    // For each network fetch balances and transactions concurrently
    const responses = await Promise.all(
      networks.map(async (network) => {
        // Fetch balances
        const balanceResp = await fetch(
          `/api/balances?network=${encodeURIComponent(network)}&address=${encodeURIComponent(addressInput)}`
        );
        const balanceData = await balanceResp.json();
        // Fetch transactions
        const txResp = await fetch(
          `/api/transactions?network=${encodeURIComponent(network)}&address=${encodeURIComponent(addressInput)}`
        );
        const txData = await txResp.json();
        return { network, balanceData, txData };
      })
    );
    // Clear loading
    resultsContainer.innerHTML = '';
    responses.forEach(({ network, balanceData, txData }) => {
      const card = buildResultCard(network, balanceData, txData);
      resultsContainer.appendChild(card);
    });
  } catch (err) {
    console.error('Fetch error', err);
    resultsContainer.innerHTML = '<p class="error">An error occurred while fetching data.</p>';
  }
});

// Build a result card for a specific network
function buildResultCard(network, balanceData, txData) {
  const card = document.createElement('div');
  card.className = 'result-card';
  // Header
  const h3 = document.createElement('h3');
  h3.textContent = network.charAt(0).toUpperCase() + network.slice(1);
  card.appendChild(h3);
  // Summary section
  const summary = document.createElement('div');
  summary.className = 'summary';
  const nativeItem = document.createElement('div');
  nativeItem.className = 'summary-item';
  const nativeBalance = balanceData.nativeBalance;
  nativeItem.innerHTML =
    `<h4>Native Balance (${balanceData.nativeSymbol})</h4><p>${formatNumber(nativeBalance)}</p>`;
  summary.appendChild(nativeItem);
  const nativeValueItem = document.createElement('div');
  nativeValueItem.className = 'summary-item';
  nativeValueItem.innerHTML = `<h4>Native Value (USD)</h4><p>$${formatNumber(balanceData.nativeValueUsd)}</p>`;
  summary.appendChild(nativeValueItem);
  const portfolioValue =
    (balanceData.nativeValueUsd || 0) +
    (balanceData.tokenPortfolioValueUsd || 0);
  const portfolioItem = document.createElement('div');
  portfolioItem.className = 'summary-item';
  portfolioItem.innerHTML = `<h4>Total Portfolio (USD)</h4><p>$${formatNumber(portfolioValue)}</p>`;
  summary.appendChild(portfolioItem);
  card.appendChild(summary);
  // Token balances table
  if (balanceData.tokenBalances && balanceData.tokenBalances.length > 0) {
    const tokenTable = document.createElement('table');
    tokenTable.className = 'tokens-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Token</th><th>Balance</th><th>Value (USD)</th></tr>';
    tokenTable.appendChild(thead);
    const tbody = document.createElement('tbody');
    balanceData.tokenBalances.forEach((token) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${token.symbol}</td><td>${formatNumber(token.balance)}</td><td>$${formatNumber(token.quote)}</td>`;
      tbody.appendChild(tr);
    });
    tokenTable.appendChild(tbody);
    card.appendChild(tokenTable);
  } else {
    const noTokens = document.createElement('p');
    noTokens.textContent =
      'Token details not available (either no tokens or API key not provided).';
    card.appendChild(noTokens);
  }
  // Transactions table
  if (txData.transactions && Array.isArray(txData.transactions)) {
    if (txData.transactions.length > 0) {
      const txTable = document.createElement('table');
      txTable.className = 'transactions-table';
      const thead = document.createElement('thead');
      thead.innerHTML =
        '<tr><th>Tx Hash</th><th>Date & Time</th><th>From</th><th>To</th><th>Value</th></tr>';
      txTable.appendChild(thead);
      const tbody = document.createElement('tbody');
      txData.transactions.forEach((tx) => {
        const tr = document.createElement('tr');
        let txLink = '#';
        if (EXPLORERS[network]) {
          txLink = EXPLORERS[network] + (tx.signature || tx.txHash);
        }
        let valueDisplay = '–';
        if (tx.valueQuote != null) {
          valueDisplay = '$' + formatNumber(tx.valueQuote);
        } else if (tx.value != null) {
          valueDisplay = formatNumber(tx.value);
        }
        // For Solana signatures, tx.signature; for EVM, tx.txHash
        const hash = tx.signature || tx.txHash;
        const timestamp = tx.blockTime
          ? new Date(tx.blockTime * 1000).toLocaleString()
          : formatTimestamp(tx.timestamp);
        tr.innerHTML = `<td><a href="${txLink}" target="_blank">${truncateAddress(
          hash
        )}</a></td><td>${timestamp || ''}</td><td>${truncateAddress(
          tx.from
        )}</td><td>${truncateAddress(tx.to)}</td><td>${valueDisplay}</td>`;
        tbody.appendChild(tr);
      });
      txTable.appendChild(tbody);
      card.appendChild(txTable);
    } else {
      const noTx = document.createElement('p');
      noTx.textContent = 'No recent transactions found.';
      card.appendChild(noTx);
    }
  } else {
    const txNote = document.createElement('p');
    txNote.textContent =
      'Transaction history not available (requires API key or Solana address).';
    card.appendChild(txNote);
  }
  return card;
}