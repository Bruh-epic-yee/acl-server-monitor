document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('tableBody');
  const tableHead = document.getElementById('tableHead');
  const loadingState = document.getElementById('loadingState');
  const emptyState = document.getElementById('emptyState');
  
  const filterBtns = document.querySelectorAll('.filter-btn');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const searchInput = document.getElementById('searchInput');

  let currentTimeframe = 'weekly';
  let currentTab = 'danger'; // danger, reporters, retaliations, heatmap
  let allData = [];

  const headers = {
    danger: `
      <tr>
        <th>Rank</th>
        <th>Reported Nickname</th>
        <th>Player ID</th>
        <th>Unique Reports (Danger Score)</th>
      </tr>
    `,
    reporters: `
      <tr>
        <th>Rank</th>
        <th>Reporter ID</th>
        <th>Total Reports Submitted</th>
      </tr>
    `,
    retaliations: `
      <tr>
        <th>Time</th>
        <th>Driver A</th>
        <th>Driver B</th>
      </tr>
    `,
    heatmap: `
      <tr>
        <th>Rank</th>
        <th>Server</th>
        <th>Track</th>
        <th>Total Reports</th>
      </tr>
    `
  };

  const renderTable = (data) => {
    tableBody.innerHTML = '';
    const tabGroup = currentTab.startsWith('danger') ? 'danger' : currentTab;
    tableHead.innerHTML = headers[tabGroup];
    
    if (data.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    } else {
      emptyState.classList.add('hidden');
    }

    data.forEach((item, index) => {
      const tr = document.createElement('tr');
      if (index < 3) tr.classList.add(`rank-${index + 1}`);

      if (currentTab.startsWith('danger')) {
        tr.innerHTML = `
          <td><div class="rank-badge">${index + 1}</div></td>
          <td class="player-nick">${escapeHtml(item.reported_nickname)}</td>
          <td>
            <div class="player-id-container">
              <span class="player-id" id="pid-${index}">${escapeHtml(item.reported_id)}</span>
              <button class="copy-btn" onclick="copyToClipboard('pid-${index}')" title="Copy ID">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
            </div>
          </td>
          <td class="report-count">${item.report_count}</td>
        `;
      } else if (currentTab === 'reporters') {
        const nickDisplay = item.reporter_nickname ? `${escapeHtml(item.reporter_nickname)}<br><small style="color:var(--text-muted)">${escapeHtml(item.reporter_id)}</small>` : `<small style="color:var(--text-muted)">${escapeHtml(item.reporter_id)}</small>`;
        tr.innerHTML = `
          <td><div class="rank-badge">${index + 1}</div></td>
          <td class="player-nick">${nickDisplay}</td>
          <td class="report-count">${item.report_count}</td>
        `;
      } else if (currentTab === 'retaliations') {
        tr.innerHTML = `
          <td>${new Date(item.time_a).toLocaleString()}</td>
          <td class="player-nick">${escapeHtml(item.driver_a_nick || item.driver_a)}</td>
          <td class="player-nick">${escapeHtml(item.driver_b_nick || item.driver_b)}</td>
        `;
      } else if (currentTab === 'heatmap') {
        // Calculate max reports to scale the heatmap bar
        const maxReports = data[0] ? data[0].report_count : 1;
        const barWidth = Math.max(5, (item.report_count / maxReports) * 100);
        
        tr.innerHTML = `
          <td><div class="rank-badge">${index + 1}</div></td>
          <td class="player-nick">${escapeHtml(item.server_name)}</td>
          <td class="player-id" style="text-transform: capitalize;">${escapeHtml(item.track)}</td>
          <td>
            <div class="heatmap-bar-container">
              <div class="heatmap-bar" style="width: ${barWidth}%"></div>
              <span class="report-count">${item.report_count}</span>
            </div>
          </td>
        `;
      }
      
      tr.style.opacity = '0';
      if (index < 20) {
        tr.style.animation = `fadeInUp 0.3s ease forwards ${index * 0.02}s`;
      } else {
        tr.style.opacity = '1';
      }
      
      tableBody.appendChild(tr);
    });
  };

  const weeklyDropdownBtn = document.getElementById('weeklyDropdownBtn');
  const weeklyOptions = document.getElementById('weeklyOptions');
  const monthlyDropdownBtn = document.getElementById('monthlyDropdownBtn');
  const monthlyOptions = document.getElementById('monthlyOptions');
  const allTimeBtn = document.getElementById('allTimeBtn');
  
  const filterElements = [weeklyDropdownBtn, monthlyDropdownBtn, allTimeBtn];
  
  let currentStartDate = null;
  let currentEndDate = null;

  // The bot started recording timestamped data around Sep 24, 2026.
  // We don't want to show weeks/months before this because they have no timestamped data.
  const LAUNCH_DATE = new Date("2026-09-24T00:00:00Z");

  // Populate Weekly Select
  const populateWeekly = () => {
    weeklyOptions.innerHTML = '';
    const now = new Date();
    let hasOptions = false;
    for (let i = 0; i < 10; i++) {
      const d = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const startOfWeek = new Date(d.setDate(d.getDate() - d.getDay() + 1)); 
      const endOfWeek = new Date(startOfWeek.getTime() + 6 * 24 * 60 * 60 * 1000); 
      
      if (endOfWeek < LAUNCH_DATE) continue; 
      hasOptions = true;
      
      const startStr = startOfWeek.toISOString().split('T')[0];
      const endStr = new Date(endOfWeek.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]; 
      
      const formatOpts = { month: 'short', day: 'numeric' };
      const label = `Week of ${startOfWeek.toLocaleDateString('en-US', formatOpts)} - ${endOfWeek.toLocaleDateString('en-US', formatOpts)}`;
      
      const opt = document.createElement('div');
      opt.className = 'custom-option';
      opt.dataset.value = `${startStr}|${endStr}`;
      opt.innerText = label;
      opt.onclick = () => selectCustomOption(opt, weeklyDropdownBtn, 'weekly');
      weeklyOptions.appendChild(opt);
    }
    
    // Set default label
    if (hasOptions) {
      weeklyOptions.firstChild.classList.add('selected');
    }
  };

  // Populate Monthly Select
  const populateMonthly = () => {
    monthlyOptions.innerHTML = '';
    const now = new Date();
    let hasOptions = false;
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      
      if (endOfMonth < LAUNCH_DATE) continue; 
      hasOptions = true;
      
      const startStr = d.toISOString().split('T')[0];
      const endStr = endOfMonth.toISOString().split('T')[0];
      
      const formatOpts = { month: 'long', year: 'numeric' };
      const label = d.toLocaleDateString('en-US', formatOpts);
      
      const opt = document.createElement('div');
      opt.className = 'custom-option';
      opt.dataset.value = `${startStr}|${endStr}`;
      opt.innerText = label;
      opt.onclick = () => selectCustomOption(opt, monthlyDropdownBtn, 'monthly');
      monthlyOptions.appendChild(opt);
    }
    
    // Set default label
    if (hasOptions) {
      monthlyOptions.firstChild.classList.add('selected');
    }
  };

  // Setup Custom Dropdown Interactivity
  const toggleDropdown = (wrapper) => {
    document.querySelectorAll('.custom-select-wrapper').forEach(w => {
      if (w !== wrapper) w.classList.remove('open');
    });
    wrapper.classList.toggle('open');
  };

  weeklyDropdownBtn.parentElement.addEventListener('click', (e) => {
    if (!e.target.classList.contains('custom-option')) {
      toggleDropdown(weeklyDropdownBtn.parentElement);
    }
  });

  monthlyDropdownBtn.parentElement.addEventListener('click', (e) => {
    if (!e.target.classList.contains('custom-option')) {
      toggleDropdown(monthlyDropdownBtn.parentElement);
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select-wrapper')) {
      document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
    }
  });

  populateWeekly();
  populateMonthly();

  const updateSummaryCards = (data) => {
    const totalReportsCard = document.getElementById('totalReportsCard');
    const mostDangerousCard = document.getElementById('mostDangerousCard');
    const hottestServerCard = document.getElementById('hottestServerCard');
    
    // Total Reports
    const sum = data.reduce((acc, curr) => acc + (curr.report_count || 1), 0);
    totalReportsCard.innerText = sum;
    
    if (data.length > 0) {
      if (currentTab === 'heatmap') {
        hottestServerCard.innerText = data[0].server_name;
        mostDangerousCard.innerText = '-';
      } else if (currentTab === 'retaliations') {
        mostDangerousCard.innerText = data[0].driver_a_nick || data[0].driver_a;
        hottestServerCard.innerText = '-';
      } else {
        mostDangerousCard.innerText = data[0].reported_nickname || data[0].reported_id || data[0].reporter_nickname || data[0].reporter_id;
        hottestServerCard.innerText = '-';
      }
    } else {
      mostDangerousCard.innerText = '-';
      hottestServerCard.innerText = '-';
    }
  };

  const fetchData = async () => {
    try {
      tableBody.innerHTML = '';
      emptyState.classList.add('hidden');
      loadingState.classList.remove('hidden');

      let endpoint = '/api/reports';
      if (currentTab === 'reporters') endpoint = '/api/reporters';
      if (currentTab === 'retaliations') endpoint = '/api/retaliations';
      if (currentTab === 'heatmap') endpoint = '/api/heatmaps';

      let url = `${endpoint}?timeframe=${currentTimeframe}`;
      if (currentStartDate && currentEndDate) {
        url = `${endpoint}?startDate=${currentStartDate}&endDate=${currentEndDate}`;
      }
      
      if (currentTab === 'danger-bad') url += '&reason=BAD BEHAVIOR';
      if (currentTab === 'danger-cheat') url += '&reason=CHEATING';

      const response = await fetch(url);
      allData = await response.json();

      loadingState.classList.add('hidden');
      applySearchFilter();
    } catch (err) {
      console.error('Error fetching data:', err);
      loadingState.classList.add('hidden');
      emptyState.innerHTML = '<p>Error loading data. Is the bot running? 🛑</p>';
      emptyState.classList.remove('hidden');
    }
  };

  const applySearchFilter = () => {
    const searchTerm = searchInput.value.toLowerCase();
    
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    if (searchTerm.length > 0) {
      clearSearchBtn.classList.remove('hidden');
    } else {
      clearSearchBtn.classList.add('hidden');
    }

    const filteredData = allData.filter(item => {
      if (currentTab.startsWith('danger')) {
        return item.reported_nickname?.toLowerCase().includes(searchTerm) || item.reported_id?.toLowerCase().includes(searchTerm);
      } else if (currentTab === 'reporters') {
        return item.reporter_nickname?.toLowerCase().includes(searchTerm) || item.reporter_id?.toLowerCase().includes(searchTerm);
      } else if (currentTab === 'retaliations') {
        return item.driver_a_nick?.toLowerCase().includes(searchTerm) || item.driver_b_nick?.toLowerCase().includes(searchTerm);
      } else if (currentTab === 'heatmap') {
        return item.server_name?.toLowerCase().includes(searchTerm) || item.track?.toLowerCase().includes(searchTerm);
      }
      return true;
    });
    
    updateSummaryCards(filteredData);
    renderTable(filteredData);
  };

  // Setup search
  searchInput.addEventListener('input', applySearchFilter);
  
  document.getElementById('clearSearchBtn').addEventListener('click', () => {
    searchInput.value = '';
    applySearchFilter();
    searchInput.focus();
  });

  // Filter selection handler
  const selectCustomOption = (optionElement, btnElement, timeframeValue) => {
    // UI Updates
    document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
    
    btnElement.parentElement.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
    optionElement.classList.add('selected');
    
    filterElements.forEach(el => el.classList.remove('active'));
    btnElement.classList.add('active');
    
    // Reset the other select if necessary
    if (btnElement !== weeklyDropdownBtn) {
      const firstWeek = weeklyOptions.firstChild;
      if (firstWeek) {
        weeklyOptions.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
        firstWeek.classList.add('selected');
      }
    }
    if (btnElement !== monthlyDropdownBtn) {
      const firstMonth = monthlyOptions.firstChild;
      if (firstMonth) {
        monthlyOptions.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
        firstMonth.classList.add('selected');
      }
    }

    let val = optionElement.dataset.value;

    if (val && val.includes('|')) {
      const [start, end] = val.split('|');
      currentStartDate = start;
      currentEndDate = end;
      currentTimeframe = 'custom';
    } else {
      currentStartDate = null;
      currentEndDate = null;
      currentTimeframe = val || timeframeValue;
    }
    
    fetchData();
  };

  allTimeBtn.addEventListener('click', () => {
    filterElements.forEach(el => el.classList.remove('active'));
    allTimeBtn.classList.add('active');
    
    currentStartDate = null;
    currentEndDate = null;
    currentTimeframe = 'all-time';
    
    fetchData();
  });

  // Setup tabs
  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      tabBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentTab = e.target.dataset.tab;
      
      // Update search placeholder based on tab
      if (currentTab === 'heatmap') searchInput.placeholder = "Search server id...";
      else if (currentTab === 'reporters') searchInput.placeholder = "Search reporter name/id...";
      else searchInput.placeholder = "Search driver name...";

      searchInput.value = ''; // clear search on tab change
      fetchData();
    });
  });

  // Init
  if (weeklyOptions.children.length > 0) {
    selectCustomOption(weeklyOptions.firstChild, weeklyDropdownBtn, 'weekly');
  } else {
    fetchData();
  }
});

// Global function for onclick in HTML string
window.copyToClipboard = function(elementId) {
  const el = document.getElementById(elementId);
  if (el) {
    navigator.clipboard.writeText(el.innerText).then(() => {
      const originalText = el.innerText;
      el.innerText = 'Copied!';
      el.style.color = 'var(--accent-1)';
      setTimeout(() => {
        el.innerText = originalText;
        el.style.color = '';
      }, 1500);
    });
  }
};

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const style = document.createElement('style');
style.innerHTML = `
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;
document.head.appendChild(style);
