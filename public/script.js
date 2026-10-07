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
        tr.classList.add('clickable-row');
        tr.title = "Click to view server breakdown for this driver";
        
        tr.innerHTML = `
          <td><div class="rank-badge">${index + 1}</div></td>
          <td class="player-nick">${escapeHtml(item.reported_nickname)}</td>
          <td>
            <div class="player-id-container">
              <span class="player-id" id="pid-${index}">${escapeHtml(item.reported_id)}</span>
              <button class="copy-btn" onclick="copyToClipboard('pid-${index}'); event.stopPropagation();" title="Copy ID">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
            </div>
          </td>
          <td class="report-count">${item.report_count}</td>
        `;
        
        tr.addEventListener('click', () => toggleDriverDetails(item.reported_id, tr));
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
        
        tr.classList.add('clickable-row');
        tr.title = "Click to view top reported drivers for this server";
        
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
        
        tr.addEventListener('click', () => toggleServerDetails(item.server_name, tr));
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

  const toggleServerDetails = async (serverId, rowElement) => {
    const nextRow = rowElement.nextElementSibling;
    if (nextRow && nextRow.classList.contains('expanded-details')) {
      // Toggle off
      nextRow.remove();
      return;
    }
    
    // Close any other open ones (optional, but keeps UI clean)
    document.querySelectorAll('.expanded-details').forEach(el => el.remove());
    
    const detailsRow = document.createElement('tr');
    detailsRow.className = 'expanded-details';
    const td = document.createElement('td');
    td.colSpan = 4;
    td.innerHTML = `<div class="expanded-content">
      <div class="spinner"></div>
    </div>`;
    detailsRow.appendChild(td);
    rowElement.after(detailsRow);
    
    try {
      let query = `?serverId=${encodeURIComponent(serverId)}&timeframe=${currentTimeframe}`;
      if (currentStartDate && currentEndDate) {
        query += `&startDate=${currentStartDate}&endDate=${currentEndDate}`;
      }
      
      const res = await fetch(`/api/server-leaderboard${query}`);
      if (!res.ok) throw new Error('Failed to fetch data');
      const data = await res.json();
      
      let html = `<table class="sub-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Nickname</th>
            <th>ID</th>
            <th>Unique Reports</th>
          </tr>
        </thead>
        <tbody>`;
        
      if (data.length === 0) {
        html += '<tr><td colspan="4" style="text-align:center; padding: 20px;">No driver data found for this server in the selected timeframe.</td></tr>';
      } else {
        data.slice(0, 50).forEach((driver, idx) => { // show top 50
          html += `<tr>
            <td>${idx + 1}</td>
            <td class="player-nick">${escapeHtml(driver.reported_nickname)}</td>
            <td class="player-id">${escapeHtml(driver.reported_id)}</td>
            <td class="report-count">${driver.report_count}</td>
          </tr>`;
        });
      }
      html += '</tbody></table>';
      td.querySelector('.expanded-content').innerHTML = html;
      
    } catch (err) {
      td.querySelector('.expanded-content').innerHTML = `<div style="color:var(--accent-2); text-align:center;">Failed to load data</div>`;
      console.error(err);
    }
  };

  const toggleDriverDetails = async (driverId, rowElement) => {
    const nextRow = rowElement.nextElementSibling;
    if (nextRow && nextRow.classList.contains('expanded-details')) {
      nextRow.remove();
      return;
    }
    
    document.querySelectorAll('.expanded-details').forEach(el => el.remove());
    
    const detailsRow = document.createElement('tr');
    detailsRow.className = 'expanded-details';
    const td = document.createElement('td');
    td.colSpan = 4;
    td.innerHTML = `<div class="expanded-content">
      <div class="spinner"></div>
    </div>`;
    detailsRow.appendChild(td);
    rowElement.after(detailsRow);
    
    try {
      let query = `?driverId=${encodeURIComponent(driverId)}&timeframe=${currentTimeframe}`;
      if (currentStartDate && currentEndDate) {
        query += `&startDate=${currentStartDate}&endDate=${currentEndDate}`;
      }
      
      if (currentTab === 'danger-cheating') query += `&reason=CHEATING`;
      if (currentTab === 'danger-bad') query += `&reason=BAD%20BEHAVIOR`;
      
      const res = await fetch(`/api/driver-breakdown${query}`);
      if (!res.ok) throw new Error('Failed to fetch data');
      const data = await res.json();
      
      let html = `<table class="sub-table">
        <thead>
          <tr>
            <th>Server</th>
            <th>Unique Reports</th>
          </tr>
        </thead>
        <tbody>`;
        
      if (data.length === 0) {
        html += '<tr><td colspan="2" style="text-align:center; padding: 20px;">No server breakdown found for this driver in the selected timeframe.</td></tr>';
      } else {
        data.forEach((server) => {
          html += `<tr class="server-row" style="cursor:pointer;" onclick="toggleServerDetails('${driverId}', '${server.server_id}', this)">
            <td class="player-nick">${escapeHtml(server.server_name)}</td>
            <td class="report-count">${server.report_count}</td>
          </tr>`;
        });
      }
      html += '</tbody></table>';
      td.querySelector('.expanded-content').innerHTML = html;
      
    } catch (err) {
      td.querySelector('.expanded-content').innerHTML = `<div style="color:var(--accent-2); text-align:center;">Failed to load data</div>`;
      console.error(err);
    }
  };

  window.toggleServerDetails = async (driverId, serverId, rowElement) => {
    const nextRow = rowElement.nextElementSibling;
    if (nextRow && nextRow.classList.contains('expanded-server-details')) {
      nextRow.remove();
      return;
    }
    
    // Close other expanded server rows within this driver's details
    rowElement.parentElement.querySelectorAll('.expanded-server-details').forEach(el => el.remove());
    
    const detailsRow = document.createElement('tr');
    detailsRow.className = 'expanded-server-details';
    const td = document.createElement('td');
    td.colSpan = 2;
    td.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
    td.style.borderLeft = '3px solid var(--accent-1)';
    td.innerHTML = `<div class="expanded-content" style="padding: 10px;">
      <div class="spinner"></div>
    </div>`;
    detailsRow.appendChild(td);
    rowElement.after(detailsRow);
    
    try {
      let query = `?driverId=${encodeURIComponent(driverId)}&serverId=${encodeURIComponent(serverId)}&timeframe=${currentTimeframe}`;
      if (currentStartDate && currentEndDate) {
        query += `&startDate=${currentStartDate}&endDate=${currentEndDate}`;
      }
      
      if (currentTab === 'danger-cheating') query += `&reason=CHEATING`;
      if (currentTab === 'danger-bad') query += `&reason=BAD%20BEHAVIOR`;
      
      const res = await fetch(`/api/driver-server-reports${query}`);
      if (!res.ok) throw new Error('Failed to fetch data');
      const data = await res.json();
      
      let html = `<table class="sub-table" style="margin: 0; background: transparent; box-shadow: none;">
        <thead>
          <tr>
            <th style="padding: 5px 10px; font-size: 0.8rem;">Date & Time</th>
            <th style="padding: 5px 10px; font-size: 0.8rem;">Reporter</th>
            <th style="padding: 5px 10px; font-size: 0.8rem;">Reason</th>
          </tr>
        </thead>
        <tbody>`;
        
      if (data.length === 0) {
        html += '<tr><td colspan="3" style="text-align:center; padding: 10px;">No specific reports found.</td></tr>';
      } else {
        data.forEach((report) => {
          const dt = new Date(report.timestamp);
          const dateStr = dt.toLocaleString();
          html += `<tr>
            <td style="padding: 5px 10px; font-size: 0.85rem; color: var(--text-muted);">${dateStr}</td>
            <td style="padding: 5px 10px; font-size: 0.85rem;" class="player-nick">${escapeHtml(report.reporter_nickname || report.reporter_id)}</td>
            <td style="padding: 5px 10px; font-size: 0.85rem; color: var(--accent-1);">${escapeHtml(report.reported_reason || 'N/A')}</td>
          </tr>`;
        });
      }
      html += '</tbody></table>';
      td.querySelector('.expanded-content').innerHTML = html;
      
    } catch (err) {
      td.querySelector('.expanded-content').innerHTML = `<div style="color:var(--accent-2); text-align:center;">Failed to load data</div>`;
      console.error(err);
    }
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
