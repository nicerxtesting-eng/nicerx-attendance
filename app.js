/* ==========================================================================
   NiceRx Attendance Tool - Application Javascript Controller
   ========================================================================== */

// --- Global Config & State ---
const CONFIG = {
  sheetUrlKey: 'hr_crm_sheet_url',
  sessionUserKey: 'hr_crm_session_user'
};

let state = {
  sheetUrl: localStorage.getItem(CONFIG.sheetUrlKey) || '',
  currentUser: null, // { email, name, birthday, role, shiftSlot, ... }
  shiftState: 'logged_out', // 'logged_out', 'working', 'on_break'
  
  // Timer tracking
  punchInTime: null, // Date object
  breakStartTime: null, // Date object
  currentBreakType: null, // String
  totalBreakMs: 0, // Accumulated completed breaks in ms
  activeTimersInterval: null,
  
  // Break Details Cache for today
  todayBreaks: {
    tea1: 0, // minutes
    dinner: 0, // minutes
    tea2: 0, // minutes
    bioCount: 0,
    bioTime: 0 // minutes
  },
  
  // Cache for loaded data
  dashboardData: {
    attendance: [],
    breaks: [],
    leaves: [],
    holidays: [],
    users: []
  }
};

// --- Timezone Conversion Helpers (EST/IST with DST Autodetection) ---
function getESTTime(date = new Date()) {
  return new Date(date.toLocaleString("en-US", { timeZone: "America/New_York" }));
}
function getISTTime(date = new Date()) {
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

// --- Seed Mock Data (Offline Sandbox Mode) ---
function initMockData() {
  const existingUsers = localStorage.getItem('mock_users');
  let needReset = false;
  if (existingUsers) {
    try {
      const parsed = JSON.parse(existingUsers);
      const hasNiceRx = parsed.some(u => u.email.toLowerCase().indexOf('@nicerx.com') !== -1);
      if (!hasNiceRx) {
        needReset = true;
      }
    } catch(e) {
      needReset = true;
    }
  }

  if (needReset) {
    localStorage.removeItem('mock_users');
    localStorage.removeItem('mock_attendance');
    localStorage.removeItem('mock_breaks');
    localStorage.removeItem('mock_leaves');
    localStorage.removeItem('mock_holidays');
  }

  if (!localStorage.getItem('mock_users')) {
    const mockUsers = [
      { 
        email: 'hr@nicerx.com', passwordHash: sha256('admin123'), name: 'Alice Green (HR)', 
        birthday: '1990-08-15', role: 'Admin', signupDate: new Date().toISOString(),
        shiftSlot: '8:30 AM EST', earnedLeavesAvailable: 15, earnedLeavesUsed: 0,
        sickLeavesAvailable: 6.5, sickLeavesUsed: 0
      },
      { 
        email: 'agent1@nicerx.com', passwordHash: sha256('agent123'), name: 'Bob Johnson', 
        birthday: new Date().toISOString().split('T')[0], role: 'Employee', signupDate: new Date().toISOString(), // Today
        shiftSlot: '8:30 AM EST', earnedLeavesAvailable: 15, earnedLeavesUsed: 0,
        sickLeavesAvailable: 6.5, sickLeavesUsed: 0
      },
      { 
        email: 'agent2@nicerx.com', passwordHash: sha256('agent123'), name: 'Jane Smith', 
        birthday: '1995-10-12', role: 'Employee', signupDate: new Date().toISOString(),
        shiftSlot: '10:00 AM EST', earnedLeavesAvailable: 15, earnedLeavesUsed: 0,
        sickLeavesAvailable: 6.5, sickLeavesUsed: 0
      }
    ];
    localStorage.setItem('mock_users', JSON.stringify(mockUsers));
  }
  
  if (!localStorage.getItem('mock_holidays')) {
    const currentYear = new Date().getFullYear();
    const mockHolidays = [
      { name: "New Year's Day", date: `${currentYear}-01-01` },
      { name: "Memorial Day", date: `${currentYear}-05-25` },
      { name: "Independence Day", date: `${currentYear}-07-04` },
      { name: "Labor Day", date: `${currentYear}-09-07` },
      { name: "Thanksgiving Day", date: `${currentYear}-11-26` },
      { name: "Christmas Day", date: `${currentYear}-12-25` }
    ];
    localStorage.setItem('mock_holidays', JSON.stringify(mockHolidays));
  }
  
  if (!localStorage.getItem('mock_attendance')) {
    // Seed some attendance data for leaderboard calculations
    const today = getESTTime();
    const currentMonth = today.getMonth() + 1;
    const year = today.getFullYear();
    const pad = (n) => n.toString().padStart(2, '0');
    
    const mockAttendance = [
      { email: 'agent1@nicerx.com', date: `${year}-${pad(currentMonth)}-01`, punchIn: new Date(`${year}-${pad(currentMonth)}-01T13:00:00Z`).toISOString(), punchOut: new Date(`${year}-${pad(currentMonth)}-01T21:00:00Z`).toISOString(), totalWorkHours: 8.0, totalBreakMinutes: 60, status: 'Present', shiftSlot: '8:30 AM EST' },
      { email: 'agent1@nicerx.com', date: `${year}-${pad(currentMonth)}-02`, punchIn: new Date(`${year}-${pad(currentMonth)}-02T13:00:00Z`).toISOString(), punchOut: new Date(`${year}-${pad(currentMonth)}-02T21:00:00Z`).toISOString(), totalWorkHours: 8.0, totalBreakMinutes: 55, status: 'Present', shiftSlot: '8:30 AM EST' },
      { email: 'agent2@nicerx.com', date: `${year}-${pad(currentMonth)}-01`, punchIn: new Date(`${year}-${pad(currentMonth)}-01T14:40:00Z`).toISOString(), punchOut: new Date(`${year}-${pad(currentMonth)}-01T22:45:00Z`).toISOString(), totalWorkHours: 7.5, totalBreakMinutes: 65, status: 'Late Login', shiftSlot: '10:00 AM EST' }
    ];
    localStorage.setItem('mock_attendance', JSON.stringify(mockAttendance));
  }
  
  if (!localStorage.getItem('mock_breaks')) {
    localStorage.setItem('mock_breaks', JSON.stringify([]));
  }
  if (!localStorage.getItem('mock_leaves')) {
    localStorage.setItem('mock_leaves', JSON.stringify([]));
  }
}

// --- SHA-256 Hash Tool ---
function sha256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  var mathPow = Math.pow;
  var maxWord = mathPow(2, 32);
  var lengthProperty = 'length';
  var i, j;
  var result = '';
  var words = [];
  var asciiLength = ascii[lengthProperty];
  var hash = [];
  var k = [];
  var primeCounter = 0;
  var isComposite = {};
  for (var candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return;
    words[i >> 2] |= j << ((3 - i % 4) * 8);
  }
  words[words[lengthProperty]] = ((asciiLength * 8) / maxWord) | 0;
  words[words[lengthProperty]] = (asciiLength * 8);
  
  for (j = 0; j < words[lengthProperty]; ) {
    var w = words.slice(j, j += 16);
    var oldHash = hash.slice(0);
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      var wItem = w[i];
      if (i >= 16) {
        var s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        wItem = w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      var maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      var sigma0 = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      var sigma1 = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      var t1 = (hash[7] + sigma1 + ch + k[i] + wItem) | 0;
      var t2 = (sigma0 + maj) | 0;
      hash = [(t1 + t2) | 0].concat(hash);
      hash[4] = (hash[4] + t1) | 0;
      hash.length = 8;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      var b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

// --- API Router ---
async function apiCall(action, payload = {}, method = 'POST') {
  const cleanUrl = state.sheetUrl ? state.sheetUrl.trim().replace(/['"]/g, '') : null;
  
  if (cleanUrl) {
    try {
      let response;
      if (method === 'GET') {
        const queryParams = new URLSearchParams({ action, ...payload }).toString();
        const sep = cleanUrl.includes('?') ? '&' : '?';
        response = await fetch(`${cleanUrl}${sep}${queryParams}`, {
          method: 'GET',
          redirect: 'follow'
        });
      } else {
        response = await fetch(cleanUrl, {
          method: 'POST',
          body: JSON.stringify({ action, ...payload }),
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          redirect: 'follow'
        });
      }
      
      if (response.ok) {
        const data = await response.json();
        if (data.success !== undefined) return data;
      }
      throw new Error(`Server returned status: ${response.status}`);
    } catch (err) {
      console.warn("Sheet API notice:", err.message, "- Executing zero-downtime local sandbox fallback.");
      initMockData();
      return handleMockApiRequest(action, payload, method);
    }
  } else {
    return new Promise((resolve) => {
      setTimeout(() => {
        initMockData();
        const res = handleMockApiRequest(action, payload, method);
        resolve(res);
      }, 150);
    });
  }
}

// Local Storage Handler (Mocking Google Sheets with balances logic)
function handleMockApiRequest(action, payload, method) {
  try {
    if (method === 'GET' && action === 'getData') {
      const email = payload.email;
      const users = JSON.parse(localStorage.getItem('mock_users') || '[]');
      const currentUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());
      
      if (!currentUser) return { success: false, error: "User not found" };
      const isAdmin = currentUser.role === 'Admin';
      
      const allAttendance = JSON.parse(localStorage.getItem('mock_attendance') || '[]');
      const allBreaks = JSON.parse(localStorage.getItem('mock_breaks') || '[]');
      const allLeaves = JSON.parse(localStorage.getItem('mock_leaves') || '[]');
      const holidays = JSON.parse(localStorage.getItem('mock_holidays') || '[]');
      
      const attendance = isAdmin ? allAttendance : allAttendance.filter(a => a.email.toLowerCase() === email.toLowerCase());
      const breaks = isAdmin ? allBreaks : allBreaks.filter(b => b.email.toLowerCase() === email.toLowerCase());
      const leaves = allLeaves
        .map((l, index) => ({ ...l, rowId: index + 1 }))
        .filter(l => isAdmin || l.email.toLowerCase() === email.toLowerCase());
        
      return {
        success: true,
        user: currentUser,
        attendance,
        breaks,
        leaves,
        holidays,
        users: users.map(u => ({ email: u.email, name: u.name, birthday: u.birthday, role: u.role, shiftSlot: u.shiftSlot }))
      };
    }
    
    if (method === 'POST') {
      if (action === 'signup') {
        const users = JSON.parse(localStorage.getItem('mock_users') || '[]');
        if (users.some(u => u.email.toLowerCase() === payload.email.toLowerCase())) {
          return { success: false, error: "User already registered" };
        }
        
        users.push({
          email: payload.email,
          password: payload.password,
          passwordHash: sha256(payload.password),
          name: payload.name,
          birthday: payload.birthday,
          role: payload.role || 'Employee',
          shiftSlot: payload.shiftSlot || '8:30 AM EST',
          signupDate: new Date().toISOString(),
          earnedLeavesAvailable: 15,
          earnedLeavesUsed: 0,
          sickLeavesAvailable: 6.5,
          sickLeavesUsed: 0
        });
        localStorage.setItem('mock_users', JSON.stringify(users));
        return { success: true, message: "Registered successfully!" };
      }
      
      if (action === 'login') {
        const users = JSON.parse(localStorage.getItem('mock_users') || '[]');
        const pwdHash = sha256(payload.password);
        const match = users.find(u => 
          u.email.toLowerCase() === payload.email.toLowerCase() && 
          (u.password === payload.password || u.passwordHash === pwdHash)
        );
        
        if (match) return { success: true, user: match };
        return { success: false, error: "Invalid email or password" };
      }

      if (action === 'resetPassword') {
        const users = JSON.parse(localStorage.getItem('mock_users') || '[]');
        const user = users.find(u => u.email.toLowerCase() === payload.email.toLowerCase());
        if (!user) return { success: false, error: "No account found with this email address." };
        if (user.birthday === payload.birthday) {
          user.password = payload.newPassword;
          user.passwordHash = sha256(payload.newPassword);
          localStorage.setItem('mock_users', JSON.stringify(users));
          return { success: true, message: "Password reset successfully!" };
        } else {
          return { success: false, error: "Validation failed: Date of Birth does not match our records." };
        }
      }

      if (action === 'swapShift') {
        const users = JSON.parse(localStorage.getItem('mock_users') || '[]');
        const user = users.find(u => u.email.toLowerCase() === payload.email.toLowerCase());
        if (!user) return { success: false, error: "User not found" };
        user.shiftSlot = payload.newShiftSlot;
        localStorage.setItem('mock_users', JSON.stringify(users));
        return { success: true, message: "Shift slot updated!" };
      }
      
      if (action === 'punchIn') {
        const att = JSON.parse(localStorage.getItem('mock_attendance') || '[]');
        att.push({
          email: payload.email,
          date: payload.date,
          punchIn: payload.timestamp,
          punchOut: '',
          totalWorkHours: 0,
          totalBreakMinutes: 0,
          status: payload.status || 'Present',
          shiftSlot: payload.shiftSlot
        });
        localStorage.setItem('mock_attendance', JSON.stringify(att));
        return { success: true, message: "Clocked in" };
      }
      
      if (action === 'punchOut') {
        const att = JSON.parse(localStorage.getItem('mock_attendance') || '[]');
        let updated = false;
        
        for (let i = att.length - 1; i >= 0; i--) {
          if (att[i].email.toLowerCase() === payload.email.toLowerCase() && 
              att[i].date === payload.date && 
              att[i].punchOut === '') {
            
            att[i].punchOut = payload.timestamp;
            att[i].totalWorkHours = parseFloat(payload.totalWorkHours);
            att[i].totalBreakMinutes = parseFloat(payload.totalBreakMinutes);
            att[i].status = payload.status;
            updated = true;
            break;
          }
        }
        
        if (!updated) {
          att.push({
            email: payload.email,
            date: payload.date,
            punchIn: '',
            punchOut: payload.timestamp,
            totalWorkHours: parseFloat(payload.totalWorkHours),
            totalBreakMinutes: parseFloat(payload.totalBreakMinutes),
            status: payload.status,
            shiftSlot: ''
          });
        }
        
        localStorage.setItem('mock_attendance', JSON.stringify(att));
        return { success: true, message: "Clocked out" };
      }
      
      if (action === 'startBreak') {
        const br = JSON.parse(localStorage.getItem('mock_breaks') || '[]');
        br.push({
          email: payload.email,
          date: payload.date,
          breakType: payload.breakType,
          breakStart: payload.timestamp,
          breakEnd: '',
          breakDurationMinutes: 0
        });
        localStorage.setItem('mock_breaks', JSON.stringify(br));
        return { success: true, message: "Break started" };
      }
      
      if (action === 'endBreak') {
        const br = JSON.parse(localStorage.getItem('mock_breaks') || '[]');
        let updated = false;
        
        for (let i = br.length - 1; i >= 0; i--) {
          if (br[i].email.toLowerCase() === payload.email.toLowerCase() && 
              br[i].date === payload.date && 
              br[i].breakEnd === '') {
            
            br[i].breakEnd = payload.timestamp;
            br[i].breakDurationMinutes = parseFloat(payload.breakDurationMinutes);
            updated = true;
            break;
          }
        }
        
        localStorage.setItem('mock_breaks', JSON.stringify(br));
        return { success: updated, message: updated ? "Break ended" : "No active break found" };
      }
      
      if (action === 'applyLeave') {
        const lv = JSON.parse(localStorage.getItem('mock_leaves') || '[]');
        lv.push({
          email: payload.email,
          leaveType: payload.leaveType,
          startDate: payload.startDate,
          endDate: payload.endDate,
          reason: payload.reason,
          status: 'Pending',
          docsSubmitted: payload.docsSubmitted ? "Yes" : "No"
        });
        localStorage.setItem('mock_leaves', JSON.stringify(lv));
        return { success: true, message: "Leave applied!" };
      }
      
      if (action === 'updateLeave') {
        const lv = JSON.parse(localStorage.getItem('mock_leaves') || '[]');
        const idx = payload.rowId - 1;
        if (lv[idx]) {
          lv[idx].status = payload.status;
          localStorage.setItem('mock_leaves', JSON.stringify(lv));
          
          // Apply leaf balances deduction on mock database if approved
          if (payload.status === 'Approved') {
            const users = JSON.parse(localStorage.getItem('mock_users') || '[]');
            const uIdx = users.findIndex(u => u.email.toLowerCase() === lv[idx].email.toLowerCase());
            
            if (uIdx !== -1) {
              // Calculate days
              const sDate = new Date(lv[idx].startDate);
              const eDate = new Date(lv[idx].endDate);
              let totalDays = 0;
              let cur = new Date(sDate);
              while (cur <= eDate) {
                if (cur.getDay() !== 0 && cur.getDay() !== 6) totalDays++;
                cur.setDate(cur.getDate() + 1);
              }
              
              if (lv[idx].leaveType === 'Half-day sick leave (HDSL)' || lv[idx].leaveType === 'Half-day leave without pay (HDLWP)') {
                totalDays = 0.5;
              }
              
              if (lv[idx].leaveType.includes('Earned Leave')) {
                users[uIdx].earnedLeavesAvailable = Math.max(0, users[uIdx].earnedLeavesAvailable - totalDays);
                users[uIdx].earnedLeavesUsed += totalDays;
              } else if (lv[idx].leaveType.includes('Sick Leave') || lv[idx].leaveType.includes('HDSL')) {
                users[uIdx].sickLeavesAvailable = Math.max(0, users[uIdx].sickLeavesAvailable - totalDays);
                users[uIdx].sickLeavesUsed += totalDays;
              }
              localStorage.setItem('mock_users', JSON.stringify(users));
            }
          }
          
          return { success: true, message: `Mock Leave status updated to ${payload.status}` };
        }
        return { success: false, error: "Mock leave row not found" };
      }
    }
    return { success: false, error: "Mock handler not found" };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

// --- DOM References ---
const DOM = {
  notification: document.getElementById('notification'),
  notificationMsg: document.getElementById('notification-message'),
  notificationClose: document.getElementById('notification-close'),
  
  authContainer: document.getElementById('auth-container'),
  appContainer: document.getElementById('app-container'),
  
  loginForm: document.getElementById('login-form'),
  signupForm: document.getElementById('signup-form'),
  
  toggleToSignup: document.getElementById('toggle-to-signup'),
  toggleToLogin: document.getElementById('toggle-to-login'),
  
  navbarUsername: document.getElementById('navbar-username'),
  navbarRole: document.getElementById('navbar-role'),
  logoutBtn: document.getElementById('logout-btn'),
  
  configBtn: document.getElementById('config-btn'),
  configModal: document.getElementById('config-modal'),
  closeModal: document.querySelector('.close-modal'),
  saveConfigBtn: document.getElementById('save-config-btn'),
  configUrlInput: document.getElementById('config-url'),
  connectionStatusBadge: document.getElementById('connection-status-badge'),
  
  // Clocks and Timers
  shiftBadge: document.getElementById('shift-badge'),
  dbClock: document.getElementById('dashboard-clock'),
  dbDate: document.getElementById('dashboard-date'),
  estClock: document.getElementById('est-clock'),
  shiftStatusText: document.getElementById('shift-status-text'),
  userShiftSlot: document.getElementById('user-shift-slot'),
  shiftTimer: document.getElementById('shift-timer'),
  breakTimer: document.getElementById('break-timer'),
  totalShiftTimer: document.getElementById('total-shift-timer'),
  btnPunch: document.getElementById('btn-punch'),
  btnPunchText: document.getElementById('btn-punch-text'),
  
  // NiceRx Break dropdowns
  breakTypeSelect: document.getElementById('break-type-select'),
  btnBreak: document.getElementById('btn-break'),
  btnBreakText: document.getElementById('btn-break-text'),
  
  // Break details list
  usedTea1: document.getElementById('used-tea1'),
  usedDinner: document.getElementById('used-dinner'),
  usedTea2: document.getElementById('used-tea2'),
  usedBio: document.getElementById('used-bio'),
  
  // Leave Balance Display
  balElAvail: document.getElementById('bal-el-avail'),
  balElUsed: document.getElementById('bal-el-used'),
  balElRem: document.getElementById('bal-el-rem'),
  balSlAvail: document.getElementById('bal-sl-avail'),
  balSlUsed: document.getElementById('bal-sl-used'),
  balSlRem: document.getElementById('bal-sl-rem'),
  
  // Leave Form
  leaveForm: document.getElementById('leave-form'),
  leaveType: document.getElementById('leave-type'),
  leaveStart: document.getElementById('leave-start'),
  leaveEnd: document.getElementById('leave-end'),
  leaveReason: document.getElementById('leave-reason'),
  hospitalDocGroup: document.getElementById('hospital-doc-group'),
  hospitalDocCheckbox: document.getElementById('hospital-doc-submitted'),
  myLeavesBody: document.getElementById('my-leaves-body'),
  
  // Leaderboard Summary Board
  bestAttMonth: document.getElementById('best-att-month'),
  bestAttQuarter: document.getElementById('best-att-quarter'),
  bestAttHalf: document.getElementById('best-att-half'),
  bestAttYear: document.getElementById('best-att-year'),
  bestPunctualMonth: document.getElementById('best-punctual-month'),
  bestBreaksMonth: document.getElementById('best-breaks-month'),
  
  // Histories
  attendanceHistoryBody: document.getElementById('attendance-history-body'),
  tabBirthdays: document.getElementById('tab-birthdays'),
  tabHolidays: document.getElementById('tab-holidays'),
  birthdaysList: document.getElementById('birthdays-list'),
  holidaysList: document.getElementById('holidays-list'),
  
  // Admin portal
  adminPanel: document.getElementById('admin-panel'),
  adminTabLeaves: document.getElementById('admin-tab-leaves'),
  adminTabAttendance: document.getElementById('admin-tab-attendance'),
  adminLeavesContent: document.getElementById('admin-leaves-content'),
  adminAttendanceContent: document.getElementById('admin-attendance-content'),
  adminLeavesBody: document.getElementById('admin-leaves-body'),
  adminAttendanceBody: document.getElementById('admin-attendance-body'),
  
  // Reset Password & Eye Toggles
  resetForm: document.getElementById('reset-form'),
  toggleToReset: document.getElementById('toggle-to-reset'),
  toggleResetToLogin: document.getElementById('toggle-reset-to-login'),
  
  // Shift Swap
  btnSwapShift: document.getElementById('btn-swap-shift'),
  
  // Export Report Dialog
  adminExportBtn: document.getElementById('admin-export-btn'),
  exportModal: document.getElementById('export-modal'),
  closeExportModal: document.getElementById('close-export-modal'),
  exportAgentSelect: document.getElementById('export-agent-select'),
  exportModeSelect: document.getElementById('export-mode-select'),
  exportMonthControls: document.getElementById('export-month-controls'),
  exportDaterangeControls: document.getElementById('export-daterange-controls'),
  exportYearSelect: document.getElementById('export-year-select'),
  exportStartMonth: document.getElementById('export-start-month'),
  exportEndMonth: document.getElementById('export-end-month'),
  exportStartDate: document.getElementById('export-start-date'),
  exportEndDate: document.getElementById('export-end-date'),
  btnTriggerExport: document.getElementById('btn-trigger-export')
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initMockData();
  setupEventListeners();
  checkSession();
  updateConnectionStatusUI();
});

// --- View State Controllers & Session Checks ---
function checkSession() {
  const cachedUser = localStorage.getItem(CONFIG.sessionUserKey);
  if (cachedUser) {
    state.currentUser = JSON.parse(cachedUser);
    enterAppSession();
  } else {
    exitAppSession();
  }
}

function enterAppSession() {
  DOM.authContainer.classList.add('hidden');
  DOM.appContainer.classList.remove('hidden');
  
  DOM.navbarUsername.textContent = state.currentUser.name;
  DOM.navbarRole.textContent = state.currentUser.role;
  DOM.userShiftSlot.textContent = state.currentUser.shiftSlot || "8:30 AM EST";
  
  if (state.currentUser.role === 'Admin') {
    DOM.adminPanel.classList.remove('hidden');
  } else {
    DOM.adminPanel.classList.add('hidden');
  }
  
  loadDashboardData();
}

function exitAppSession() {
  state.currentUser = null;
  localStorage.removeItem(CONFIG.sessionUserKey);
  
  stopActiveTimers();
  state.shiftState = 'logged_out';
  state.punchInTime = null;
  state.breakStartTime = null;
  state.currentBreakType = null;
  state.totalBreakMs = 0;
  
  DOM.appContainer.classList.add('hidden');
  DOM.authContainer.classList.remove('hidden');
  DOM.loginForm.reset();
  DOM.signupForm.reset();
}

// --- Notifications ---
function showNotification(message, type = 'success') {
  DOM.notificationMsg.textContent = message;
  DOM.notification.className = 'notification active';
  if (type === 'error') DOM.notification.classList.add('error');
  if (type === 'warning') DOM.notification.classList.add('warning');
  
  setTimeout(() => {
    DOM.notification.classList.remove('active');
  }, 5000);
}

// --- Event Listeners ---
function setupEventListeners() {
  DOM.notificationClose.addEventListener('click', () => {
    DOM.notification.classList.remove('active');
  });

  DOM.toggleToSignup.addEventListener('click', (e) => {
    e.preventDefault();
    DOM.loginForm.classList.remove('active');
    DOM.signupForm.classList.add('active');
  });

  DOM.toggleToLogin.addEventListener('click', (e) => {
    e.preventDefault();
    DOM.signupForm.classList.remove('active');
    DOM.loginForm.classList.add('active');
  });

  // Login
  DOM.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    const res = await apiCall('login', { email, password });
    if (res.success) {
      state.currentUser = res.user;
      localStorage.setItem(CONFIG.sessionUserKey, JSON.stringify(res.user));
      showNotification(`NiceRx Agent Session Validated: ${res.user.name}`);
      enterAppSession();
    } else {
      showNotification(res.error || "Authentication failed", 'error');
    }
  });

  // Signup
  DOM.signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('signup-name').value;
    const email = document.getElementById('signup-email').value;
    const birthday = document.getElementById('signup-birthday').value;
    const shiftSlot = document.getElementById('signup-slot').value;
    const role = document.getElementById('signup-role').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;
    
    if (password !== confirmPassword) {
      showNotification("Passwords do not match!", "error");
      return;
    }
    
    const res = await apiCall('signup', { name, email, birthday, shiftSlot, role, password });
    if (res.success) {
      showNotification("Agent registered successfully! Please log in.");
      DOM.signupForm.classList.remove('active');
      DOM.loginForm.classList.add('active');
      document.getElementById('login-email').value = email;
    } else {
      showNotification(res.error || "Registration failed", 'error');
    }
  });

  DOM.logoutBtn.addEventListener('click', () => {
    exitAppSession();
    showNotification("Session terminated.");
  });

  DOM.configBtn.addEventListener('click', () => {
    DOM.configUrlInput.value = state.sheetUrl;
    DOM.configModal.classList.remove('hidden');
  });

  DOM.closeModal.addEventListener('click', () => {
    DOM.configModal.classList.add('hidden');
  });

  DOM.saveConfigBtn.addEventListener('click', () => {
    const url = DOM.configUrlInput.value.trim();
    state.sheetUrl = url;
    if (url) {
      localStorage.setItem(CONFIG.sheetUrlKey, url);
      showNotification("NiceRx Sheet Connected!");
    } else {
      localStorage.removeItem(CONFIG.sheetUrlKey);
      showNotification("Database URL cleared. Running offline sandbox.", "warning");
    }
    updateConnectionStatusUI();
    DOM.configModal.classList.add('hidden');
    if (state.currentUser) loadDashboardData();
  });

  // Shift & Break Triggers
  DOM.btnPunch.addEventListener('click', handlePunchAction);
  DOM.btnBreak.addEventListener('click', handleBreakAction);

  // Leave Form Doc check visibility
  DOM.leaveType.addEventListener('change', () => {
    if (DOM.leaveType.value === "Hospital Leave (HL)") {
      DOM.hospitalDocGroup.classList.remove('hidden');
    } else {
      DOM.hospitalDocGroup.classList.add('hidden');
    }
  });

  DOM.leaveForm.addEventListener('submit', handleLeaveApplicationSubmit);

  // Birthday & Holidays Tab
  DOM.tabBirthdays.addEventListener('click', () => {
    DOM.tabHolidays.classList.remove('active');
    DOM.tabBirthdays.classList.add('active');
    DOM.holidaysList.classList.remove('active');
    DOM.birthdaysList.classList.add('active');
  });

  DOM.tabHolidays.addEventListener('click', () => {
    DOM.tabBirthdays.classList.remove('active');
    DOM.tabHolidays.classList.add('active');
    DOM.birthdaysList.classList.remove('active');
    DOM.holidaysList.classList.add('active');
  });

  // Admin Tab Switchers
  DOM.adminTabLeaves.addEventListener('click', () => {
    DOM.adminTabAttendance.classList.remove('active');
    DOM.adminTabLeaves.classList.add('active');
    DOM.adminAttendanceContent.classList.remove('active');
    DOM.adminLeavesContent.classList.add('active');
  });
  DOM.adminTabAttendance.addEventListener('click', () => {
    DOM.adminTabLeaves.classList.remove('active');
    DOM.adminTabAttendance.classList.add('active');
    DOM.adminLeavesContent.classList.remove('active');
    DOM.adminAttendanceContent.classList.add('active');
  });

  // Forgot Password Toggles
  if (DOM.toggleToReset) {
    DOM.toggleToReset.addEventListener('click', (e) => {
      e.preventDefault();
      DOM.loginForm.classList.remove('active');
      DOM.signupForm.classList.remove('active');
      DOM.resetForm.classList.add('active');
    });
  }

  if (DOM.toggleResetToLogin) {
    DOM.toggleResetToLogin.addEventListener('click', (e) => {
      e.preventDefault();
      DOM.resetForm.classList.remove('active');
      DOM.signupForm.classList.remove('active');
      DOM.loginForm.classList.add('active');
    });
  }

  // Eye Icon Password Visibility Toggles
  document.querySelectorAll('.toggle-password').forEach(icon => {
    icon.addEventListener('click', () => {
      const targetId = icon.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input) {
        const currentType = input.getAttribute('type');
        const newType = currentType === 'password' ? 'text' : 'password';
        input.setAttribute('type', newType);
        icon.classList.toggle('fa-eye');
        icon.classList.toggle('fa-eye-slash');
      }
    });
  });

  // Password Reset Submission Handler
  if (DOM.resetForm) {
    DOM.resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('reset-email').value;
      const birthday = document.getElementById('reset-birthday').value;
      const newPassword = document.getElementById('reset-new-password').value;
      const confirmPassword = document.getElementById('reset-confirm-password').value;

      if (newPassword !== confirmPassword) {
        showNotification("New passwords do not match!", "error");
        return;
      }

      const res = await apiCall('resetPassword', { email, birthday, newPassword });
      if (res.success) {
        showNotification("Password reset successfully! Please sign in with your new password.");
        DOM.resetForm.reset();
        DOM.resetForm.classList.remove('active');
        DOM.loginForm.classList.add('active');
        document.getElementById('login-email').value = email;
      } else {
        showNotification(res.error || "Password reset failed", "error");
      }
    });
  }

  // Shift Swap Handler
  if (DOM.btnSwapShift) {
    DOM.btnSwapShift.addEventListener('click', async () => {
      if (!state.currentUser) return;
      const currentSlot = state.currentUser.shiftSlot || "8:30 AM EST";
      const newSlot = currentSlot === "8:30 AM EST" ? "10:00 AM EST" : "8:30 AM EST";

      const res = await apiCall('swapShift', {
        email: state.currentUser.email,
        newShiftSlot: newSlot
      });

      if (res.success) {
        state.currentUser.shiftSlot = newSlot;
        DOM.userShiftSlot.textContent = newSlot;
        showNotification(`Assigned Shift Slot swapped to: ${newSlot}`);
        loadDashboardData();
      } else {
        showNotification(res.error || "Failed to swap shift slot", "error");
      }
    });
  }

  // Export Mode Switcher (Month vs Date Range)
  if (DOM.exportModeSelect) {
    DOM.exportModeSelect.addEventListener('change', () => {
      if (DOM.exportModeSelect.value === 'month') {
        DOM.exportMonthControls.classList.remove('hidden');
        DOM.exportDaterangeControls.classList.add('hidden');
      } else {
        DOM.exportMonthControls.classList.add('hidden');
        DOM.exportDaterangeControls.classList.remove('hidden');
      }
    });
  }

  // Admin Export Report Listeners
  if (DOM.adminExportBtn) {
    DOM.adminExportBtn.addEventListener('click', () => {
      DOM.exportAgentSelect.innerHTML = '<option value="All Agents">All Agents (Team Report)</option>';
      state.dashboardData.users.forEach(u => {
        DOM.exportAgentSelect.innerHTML += `<option value="${u.email}">${u.name} (${u.email})</option>`;
      });

      const todayEST = getESTTime();
      const currentYear = todayEST.getFullYear();

      // Populate Year Select
      DOM.exportYearSelect.innerHTML = '';
      for (let y = currentYear; y >= currentYear - 3; y--) {
        DOM.exportYearSelect.innerHTML += `<option value="${y}">${y}</option>`;
      }

      DOM.exportStartMonth.value = todayEST.getMonth().toString();
      DOM.exportEndMonth.value = todayEST.getMonth().toString();

      const firstDay = new Date(currentYear, todayEST.getMonth(), 1);
      DOM.exportStartDate.value = firstDay.toISOString().split('T')[0];
      DOM.exportEndDate.value = todayEST.toISOString().split('T')[0];

      DOM.exportModal.classList.remove('hidden');
    });
  }

  if (DOM.closeExportModal) {
    DOM.closeExportModal.addEventListener('click', () => {
      DOM.exportModal.classList.add('hidden');
    });
  }

  if (DOM.btnTriggerExport) {
    DOM.btnTriggerExport.addEventListener('click', handleExportReportAction);
  }
}

function updateConnectionStatusUI() {
  if (state.sheetUrl) {
    DOM.connectionStatusBadge.textContent = "Google Sheets Synced";
    DOM.connectionStatusBadge.className = "badge badge-online";
    DOM.shiftBadge.textContent = "Live Google Sheet Mode";
    DOM.shiftBadge.className = "badge badge-online";
  } else {
    DOM.connectionStatusBadge.textContent = "Offline Sandbox";
    DOM.connectionStatusBadge.className = "badge badge-offline";
    DOM.shiftBadge.textContent = "Local Cache Sandbox";
    DOM.shiftBadge.className = "badge badge-offline";
  }
}

// --- Data Synchronization Layer ---
async function loadDashboardData() {
  if (!state.currentUser) return;
  
  const res = await apiCall('getData', { email: state.currentUser.email }, 'GET');
  if (res.success) {
    state.dashboardData = {
      attendance: res.attendance || [],
      breaks: res.breaks || [],
      leaves: res.leaves || [],
      holidays: res.holidays || [],
      users: res.users || []
    };
    
    if (res.user) {
      state.currentUser = res.user;
      DOM.navbarUsername.textContent = res.user.name;
      DOM.navbarRole.textContent = res.user.role;
      DOM.userShiftSlot.textContent = res.user.shiftSlot || "8:30 AM EST";
      if (res.user.role === 'Admin') {
        DOM.adminPanel.classList.remove('hidden');
      } else {
        DOM.adminPanel.classList.add('hidden');
      }
    }
    
    restoreShiftStateAndTimers();
    calculateSummaryBoard();
    renderDashboardUI();
  } else {
    showNotification("Failed to synchronize with database", 'error');
  }
}

function restoreShiftStateAndTimers() {
  const userAttendanceAll = state.dashboardData.attendance.filter(
    a => a.email.toLowerCase() === state.currentUser.email.toLowerCase()
  );
  
  const userBreaksAll = state.dashboardData.breaks.filter(
    b => b.email.toLowerCase() === state.currentUser.email.toLowerCase()
  );

  // Active shift is any punch-in that has not been closed with a punch-out
  const activeShift = userAttendanceAll.find(a => !a.punchOut || a.punchOut === '');
  
  // Calculate break categories from logs today
  const todayStr = getTodayStringEST();
  const userBreaksToday = userBreaksAll.filter(b => b.date === todayStr);
  calculateCompletedBreaksToday(userBreaksToday);
  
  if (activeShift) {
    state.punchInTime = new Date(activeShift.punchIn);
    
    // Filter breaks associated with active shift
    const shiftBreaks = userBreaksAll.filter(b => new Date(b.breakStart) >= state.punchInTime);
    state.totalBreakMs = shiftBreaks
      .filter(b => b.breakEnd && b.breakEnd !== '')
      .reduce((sum, b) => sum + (new Date(b.breakEnd) - new Date(b.breakStart)), 0);
      
    const activeBreak = shiftBreaks.find(b => !b.breakEnd || b.breakEnd === '');
    if (activeBreak) {
      state.shiftState = 'on_break';
      state.breakStartTime = new Date(activeBreak.breakStart);
      state.currentBreakType = activeBreak.breakType;
    } else {
      state.shiftState = 'working';
      state.breakStartTime = null;
      state.currentBreakType = null;
    }
    
    startActiveTimers();
  } else {
    state.shiftState = 'logged_out';
    state.punchInTime = null;
    state.breakStartTime = null;
    state.currentBreakType = null;
    state.totalBreakMs = 0;
    stopActiveTimers();
  }
  
  updateShiftControlUI();
}

// Calculate the break items from logs today
function calculateCompletedBreaksToday(userBreaks) {
  // Reset
  state.todayBreaks = { 
    tea1: 0, 
    dinner: 0, 
    tea2: 0, 
    bioCount: 0, 
    bioTime: 0,
    tea1Used: false,
    dinnerUsed: false,
    tea2Used: false
  };
  
  userBreaks.forEach(b => {
    if (b.breakType === 'Tea Break 1') {
      state.todayBreaks.tea1Used = true;
      if (b.breakEnd !== '') {
        state.todayBreaks.tea1 += (new Date(b.breakEnd) - new Date(b.breakStart)) / 60000;
      }
    } else if (b.breakType === 'Dinner Break') {
      state.todayBreaks.dinnerUsed = true;
      if (b.breakEnd !== '') {
        state.todayBreaks.dinner += (new Date(b.breakEnd) - new Date(b.breakStart)) / 60000;
      }
    } else if (b.breakType === 'Tea Break 2') {
      state.todayBreaks.tea2Used = true;
      if (b.breakEnd !== '') {
        state.todayBreaks.tea2 += (new Date(b.breakEnd) - new Date(b.breakStart)) / 60000;
      }
    } else if (b.breakType === 'Bio Break') {
      state.todayBreaks.bioCount++;
      if (b.breakEnd !== '') {
        state.todayBreaks.bioTime += (new Date(b.breakEnd) - new Date(b.breakStart)) / 60000;
      }
    }
  });
}

// --- Dynamic Clocks, DST calculations, Policy Monitors ---
let workTimerAlertFired = false;

function updateDomClocks(now = new Date()) {
  const istNow = getISTTime(now);
  const estNow = getESTTime(now);

  // Update main dashboard clocks if elements exist
  if (DOM.dbClock) DOM.dbClock.textContent = istNow.toTimeString().split(' ')[0];
  if (DOM.dbDate) DOM.dbDate.textContent = istNow.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  if (DOM.estClock) DOM.estClock.textContent = estNow.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' EST';

  // Update login page card clocks
  const authIst = document.getElementById('auth-ist-clock');
  const authEst = document.getElementById('auth-est-clock');
  if (authIst) authIst.textContent = istNow.toTimeString().split(' ')[0];
  if (authEst) authEst.textContent = estNow.toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' EST';
}

function startActiveTimers() {
  stopActiveTimers();
  workTimerAlertFired = false;
  let closingReminderFired = false;
  
  state.activeTimersInterval = setInterval(() => {
    const now = new Date();
    
    // 1. Update Dual Clocks (IST and EST) in all pages
    updateDomClocks(now);
    
    // 2. Shift End Closing Reminders & 1h Grace Window
    const estNow = getESTTime(now);
    const estHours = estNow.getHours();
    const estMins = estNow.getMinutes();
    const estDecimalHours = estHours + (estMins / 60);
    
    const userSlot = state.currentUser ? (state.currentUser.shiftSlot || "8:30 AM EST") : "8:30 AM EST";
    // Shift 1 (8:30 AM EST): ends at 16:30 (4:30 PM EST). 1h grace until 17:30 (5:30 PM EST).
    // Shift 2 (10:00 AM EST): ends at 18:00 (6:00 PM EST). 1h grace until 19:00 (7:00 PM EST).
    const shiftEndHour = userSlot === "10:00 AM EST" ? 18.0 : 16.5;
    const forceLogoutHour = shiftEndHour + 1.0; // Extra 1 hour post-shift
    
    if (state.shiftState === 'working' || state.shiftState === 'on_break') {
      if (estDecimalHours >= shiftEndHour && !closingReminderFired) {
        closingReminderFired = true;
        showNotification("Our Company has closed for the day. Please wrap up and Logout in next few minutes. Thanks.", "warning");
      }
      
      if (estDecimalHours >= forceLogoutHour) {
        handleForceLogoutClosingTime();
        return;
      }
    }
    
    // 3. Update shift indicators
    if (state.punchInTime) {
      const elapsedShiftMs = now - state.punchInTime;
      
      // Update Total Shift Time (Active Work Time + Break Time Used)
      if (DOM.totalShiftTimer) {
        DOM.totalShiftTimer.textContent = formatDurationMs(elapsedShiftMs);
      }
      
      // Update break accessibility rules (unlocked only after 2 hours = 7,200,000 ms)
      if (elapsedShiftMs >= 7200000) {
        DOM.breakTypeSelect.disabled = (state.shiftState === 'logged_out');
        DOM.btnBreak.disabled = (state.shiftState === 'logged_out');
      } else {
        DOM.breakTypeSelect.disabled = true;
        DOM.btnBreak.disabled = true;
        DOM.btnBreakText.textContent = "Locked (2h)";
      }
      
      if (state.shiftState === 'working') {
        const workedMs = elapsedShiftMs - state.totalBreakMs;
        DOM.shiftTimer.textContent = formatDurationMs(workedMs);
        
        // worked hours limit reminder check
        const workedHours = workedMs / 3600000;
        if (workedHours >= 8.0 && !workTimerAlertFired) {
          workTimerAlertFired = true;
          showNotification("⚠️ Our Company has closed for the day. Please wrap up and Logout in next few minutes. Thanks.", "warning");
        }
      }
      
      if (state.shiftState === 'on_break' && state.breakStartTime) {
        const activeBreakMs = now - state.breakStartTime;
        DOM.breakTimer.textContent = formatDurationMs(activeBreakMs);
        
        const frozenWorkMs = state.breakStartTime - state.punchInTime - state.totalBreakMs;
        DOM.shiftTimer.textContent = formatDurationMs(frozenWorkMs);
        
        // Dynamic color warn if current break exceeds its allowed limits
        const activeMins = activeBreakMs / 60000;
        let isExceeded = false;
        if (state.currentBreakType === 'Tea Break 1' && activeMins > 15) isExceeded = true;
        else if (state.currentBreakType === 'Dinner Break' && activeMins > 30) isExceeded = true;
        else if (state.currentBreakType === 'Tea Break 2' && activeMins > 15) isExceeded = true;
        else if (state.currentBreakType === 'Bio Break' && activeMins > 5) isExceeded = true;
        
        if (isExceeded) {
          DOM.breakTimer.className = 'timer-val text-exceeded';
        } else {
          DOM.breakTimer.className = 'timer-val';
        }
      }
    }
  }, 1000);
}

function stopActiveTimers() {
  if (state.activeTimersInterval) {
    clearInterval(state.activeTimersInterval);
    state.activeTimersInterval = null;
  }
  
  updateDomClocks();
  
  state.activeTimersInterval = setInterval(() => {
    updateDomClocks();
  }, 1000);
}



async function handleForceLogoutClosingTime() {
  stopActiveTimers();
  showNotification("⚠️ System closing time reached (6:00 PM EST). Automatic logout triggered.", "warning");
  
  const now = new Date();
  const dateStr = getTodayStringEST();
  
  // Calculate final shift details
  if (state.shiftState === 'on_break' && state.breakStartTime) {
    const activeBreakMinutes = (now - state.breakStartTime) / 60000;
    await apiCall('endBreak', {
      email: state.currentUser.email,
      timestamp: now.toISOString(),
      date: dateStr,
      breakDurationMinutes: activeBreakMinutes
    });
    state.totalBreakMs += (now - state.breakStartTime);
  }
  
  const elapsedShiftMs = now - state.punchInTime;
  const workedHours = Math.min(8.0, (elapsedShiftMs - state.totalBreakMs) / 3600000); // Enforce closing caps
  const breakMinutes = state.totalBreakMs / 60000;
  
  const res = await apiCall('punchOut', {
    email: state.currentUser.email,
    timestamp: now.toISOString(),
    date: dateStr,
    totalWorkHours: workedHours.toFixed(4),
    totalBreakMinutes: breakMinutes.toFixed(1),
    status: calculateTodayShiftStatus(workedHours)
  });
  
  if (res.success) {
    state.shiftState = 'logged_out';
    state.punchInTime = null;
    state.breakStartTime = null;
    state.totalBreakMs = 0;
    updateShiftControlUI();
    showNotification("Automatically Logged Out for company closing.");
    loadDashboardData();
  }
}

// --- Dynamic Render UI ---
function renderDashboardUI() {
  renderLeaveBalances();
  renderAttendanceHistory();
  renderLeaveHistory();
  renderReminders();
  renderBreakStatusList();
  
  if (state.currentUser.role === 'Admin') {
    renderAdminPortal();
  }
}

// 1. Leave Balances Displays (Fixed Annual Total, Approved Used, Remaining = Total - Used)
function renderLeaveBalances() {
  const u = state.currentUser;
  
  // Earned Leaves (EL): Fixed Annual Credit = 15.0
  const elTotal = 15.0;
  const elUsed = parseFloat(u.earnedLeavesUsed || 0);
  const elRem = Math.max(0, elTotal - elUsed);
  
  DOM.balElAvail.textContent = elTotal.toFixed(1);
  DOM.balElUsed.textContent = elUsed.toFixed(1);
  DOM.balElRem.textContent = elRem.toFixed(1);
  
  // Sick Leaves (SL): Fixed Annual Credit = 6.5
  const slTotal = 6.5;
  const slUsed = parseFloat(u.sickLeavesUsed || 0);
  const slRem = Math.max(0, slTotal - slUsed);
  
  DOM.balSlAvail.textContent = slTotal.toFixed(1);
  DOM.balSlUsed.textContent = slUsed.toFixed(1);
  DOM.balSlRem.textContent = slRem.toFixed(1);
}

// 2. Break Allocation Status & Warning Checks
function renderBreakStatusList() {
  const tb = state.todayBreaks;
  
  DOM.usedTea1.textContent = `Used: ${Math.round(tb.tea1)}m`;
  if (tb.tea1 > 15) DOM.usedTea1.className = "break-used-badge text-exceeded";
  else DOM.usedTea1.className = "break-used-badge";
  
  DOM.usedDinner.textContent = `Used: ${Math.round(tb.dinner)}m`;
  if (tb.dinner > 30) DOM.usedDinner.className = "break-used-badge text-exceeded";
  else DOM.usedDinner.className = "break-used-badge";
  
  DOM.usedTea2.textContent = `Used: ${Math.round(tb.tea2)}m`;
  if (tb.tea2 > 15) DOM.usedTea2.className = "break-used-badge text-exceeded";
  else DOM.usedTea2.className = "break-used-badge";
  
  DOM.usedBio.textContent = `Count: ${tb.bioCount}/2 (${Math.round(tb.bioTime)}m)`;
  if (tb.bioCount > 2 || tb.bioTime > 10) DOM.usedBio.className = "break-used-badge text-exceeded"; // Max 5m each, so 10m total
  else DOM.usedBio.className = "break-used-badge";
  
  // Disable already utilized break options in dropdown
  updateBreakDropdownOptions();
}

function updateBreakDropdownOptions() {
  const sel = DOM.breakTypeSelect;
  if (!sel) return;
  const tb = state.todayBreaks || {};
  
  Array.from(sel.options).forEach(opt => {
    if (opt.value === 'Tea Break 1') {
      opt.disabled = !!tb.tea1Used;
      opt.text = tb.tea1Used ? 'Tea Break 1 (Max 15m) - Already Utilized' : 'Tea Break 1 (Max 15m)';
    } else if (opt.value === 'Dinner Break') {
      opt.disabled = !!tb.dinnerUsed;
      opt.text = tb.dinnerUsed ? 'Dinner Break (Max 30m) - Already Utilized' : 'Dinner Break (Max 30m)';
    } else if (opt.value === 'Tea Break 2') {
      opt.disabled = !!tb.tea2Used;
      opt.text = tb.tea2Used ? 'Tea Break 2 (Max 15m) - Already Utilized' : 'Tea Break 2 (Max 15m)';
    } else if (opt.value === 'Bio Break') {
      const isMax = (tb.bioCount || 0) >= 2;
      opt.disabled = isMax;
      opt.text = isMax 
        ? 'Bio Break (Max 2, 5m each) - Already Utilized (2/2)' 
        : `Bio Break (Max 2, 5m each) (${tb.bioCount || 0}/2 used)`;
    }
  });
}

// 3. User Attendance list
function renderAttendanceHistory() {
  const tbody = DOM.attendanceHistoryBody;
  tbody.innerHTML = '';
  
  const myLogs = state.dashboardData.attendance
    .filter(a => a.email.toLowerCase() === state.currentUser.email.toLowerCase())
    .sort((a, b) => new Date(b.date) - new Date(a.date));
    
  if (myLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-placeholder">No shifts logged today.</td></tr>`;
    return;
  }
  
  myLogs.forEach(log => {
    const clockInStr = log.punchIn ? formatTime(log.punchIn) : '-';
    const clockOutStr = log.punchOut ? formatTime(log.punchOut) : 'Active Shift';
    const workHrs = log.punchOut ? `${parseFloat(log.totalWorkHours).toFixed(2)} hrs` : '-';
    const breakMins = log.punchOut ? `${Math.round(log.totalBreakMinutes)} mins` : '-';
    
    // Status pill
    let statClass = 'status-approved';
    if (log.status === 'Absent' || log.status === 'LWP') statClass = 'status-rejected';
    if (log.status === 'Half Day' || log.status === 'Late Login') statClass = 'status-pending';
    
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${formatDate(log.date)}</strong></td>
      <td>${log.shiftSlot || '8:30 AM EST'}</td>
      <td>${clockInStr}</td>
      <td>${clockOutStr}</td>
      <td>${workHrs}</td>
      <td>${breakMins}</td>
      <td><span class="status-pill ${statClass}">${log.status}</span></td>
    `;
    tbody.appendChild(row);
  });
}

// 4. Leave request logs display
function renderLeaveHistory() {
  const tbody = DOM.myLeavesBody;
  tbody.innerHTML = '';
  
  const myLeaves = state.dashboardData.leaves
    .filter(l => l.email.toLowerCase() === state.currentUser.email.toLowerCase())
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    
  if (myLeaves.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-placeholder">No leave applications recorded.</td></tr>`;
    return;
  }
  
  myLeaves.forEach(lv => {
    const statusClass = lv.status.toLowerCase() === 'approved' ? 'status-approved' : 
                        lv.status.toLowerCase() === 'rejected' ? 'status-rejected' : 'status-pending';
                        
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><strong>${lv.leaveType}</strong></td>
      <td>${formatDate(lv.startDate)} to ${formatDate(lv.endDate)}</td>
      <td title="${lv.reason}">${truncateString(lv.reason, 20)}</td>
      <td><span class="status-pill ${statusClass}">${lv.status}</span></td>
    `;
    tbody.appendChild(row);
  });
}

// 5. Birthday and US Client Holidays Displays
function renderReminders() {
  const bList = DOM.birthdaysList;
  bList.innerHTML = '';
  
  const users = state.dashboardData.users;
  const today = getESTTime();
  const currentMonth = today.getMonth();
  const currentDate = today.getDate();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  
  const upcomingBirthdays = users
    .filter(u => u.birthday)
    .map(u => {
      let bMonth, bDay;
      const parts = u.birthday.split('-');
      if (parts.length === 3) {
        bMonth = parseInt(parts[1], 10) - 1;
        bDay = parseInt(parts[2], 10);
      } else {
        const bdate = new Date(u.birthday);
        bMonth = bdate.getMonth();
        bDay = bdate.getDate();
      }
      
      let nextBday = new Date(today.getFullYear(), bMonth, bDay);
      if (nextBday < todayStart) {
        nextBday = new Date(today.getFullYear() + 1, bMonth, bDay);
      }
      
      const diffMs = nextBday - todayStart;
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      
      const isCurrentMonth = (bMonth === currentMonth);
      const isWithinNext20Days = (diffDays >= 0 && diffDays <= 20);
      
      return {
        ...u,
        bMonth,
        bDay,
        nextBday,
        diffDays,
        isValidForDisplay: isCurrentMonth || isWithinNext20Days
      };
    })
    .filter(u => u.isValidForDisplay)
    .sort((a, b) => a.nextBday - b.nextBday);
    
  if (upcomingBirthdays.length === 0) {
    bList.innerHTML = `<li class="empty-list-placeholder">No birthdays in current month or next 20 days.</li>`;
  } else {
    upcomingBirthdays.forEach(u => {
      const isToday = u.bMonth === currentMonth && u.bDay === currentDate;
      const li = document.createElement('li');
      
      if (isToday) {
        li.className = 'today-highlight';
        li.innerHTML = `
          <span>🎉 <strong>${u.name}</strong> <span class="badge badge-online" style="font-size:0.6rem; padding: 2px 6px;">TODAY!</span></span>
          <span class="reminder-date text-teal">Happy Birthday!</span>
        `;
      } else {
        const options = { month: 'short', day: 'numeric' };
        li.innerHTML = `
          <span><i class="fa-solid fa-cake-candles text-muted" style="margin-right:8px;"></i>${u.name}</span>
          <span class="reminder-date text-teal">${u.nextBday.toLocaleDateString(undefined, options)}</span>
        `;
      }
      bList.appendChild(li);
    });
  }
  
  // US client holidays
  const hList = DOM.holidaysList;
  hList.innerHTML = '';
  
  const holidays = state.dashboardData.holidays
    .map(h => ({ ...h, parsedDate: new Date(h.date) }))
    .filter(h => h.parsedDate >= new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))
    .sort((a, b) => a.parsedDate - b.parsedDate);
    
  if (holidays.length === 0) {
    hList.innerHTML = `<li class="empty-list-placeholder">No client holidays.</li>`;
  } else {
    holidays.forEach(h => {
      const formattedDate = h.parsedDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const isToday = h.parsedDate.toDateString() === today.toDateString();
      const li = document.createElement('li');
      
      if (isToday) {
        li.className = 'today-highlight';
        li.innerHTML = `
          <span>🌴 <strong>${h.name}</strong> <span class="badge badge-offline" style="font-size:0.6rem; padding: 2px 6px;">Client Holiday</span></span>
          <span class="reminder-date">TODAY</span>
        `;
      } else {
        li.innerHTML = `
          <span><i class="fa-solid fa-umbrella-beach text-muted" style="margin-right:8px;"></i>${h.name}</span>
          <span class="reminder-date">${formattedDate}</span>
        `;
      }
      hList.appendChild(li);
    });
  }
}

// 6. Admin review listings
function renderAdminPortal() {
  // Pending leaves table
  const leavesBody = DOM.adminLeavesBody;
  leavesBody.innerHTML = '';
  
  const pendingLeaves = state.dashboardData.leaves.filter(l => l.status === 'Pending');
  
  if (pendingLeaves.length === 0) {
    leavesBody.innerHTML = `<tr><td colspan="7" class="empty-placeholder">No pending leave requests.</td></tr>`;
  } else {
    pendingLeaves.forEach(lv => {
      const docsText = lv.docsSubmitted ? `<span class="text-teal font-bold"><i class="fa-solid fa-file-circle-check"></i> Submitted</span>` : `<span class="text-muted">N/A</span>`;
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${lv.email}</strong></td>
        <td>${lv.leaveType}</td>
        <td>${formatDate(lv.startDate)} to ${formatDate(lv.endDate)}</td>
        <td title="${lv.reason}">${truncateString(lv.reason, 20)}</td>
        <td>${docsText}</td>
        <td><span class="status-pill status-pending">${lv.status}</span></td>
        <td>
          <div class="table-actions">
            <button class="btn-table-action btn-approve" onclick="updateLeaveRequest(${lv.rowId}, 'Approved')">Approve</button>
            <button class="btn-table-action btn-reject" onclick="updateLeaveRequest(${lv.rowId}, 'Rejected')">Reject</button>
          </div>
        </td>
      `;
      leavesBody.appendChild(row);
    });
  }
  
  // All team attendance logs table
  const attBody = DOM.adminAttendanceBody;
  attBody.innerHTML = '';
  
  const allLogs = [...state.dashboardData.attendance]
    .sort((a, b) => new Date(b.date) - new Date(a.date) || a.email.localeCompare(b.email));
    
  if (allLogs.length === 0) {
    attBody.innerHTML = `<tr><td colspan="8" class="empty-placeholder">No attendance logs.</td></tr>`;
  } else {
    allLogs.forEach(log => {
      const clockInStr = log.punchIn ? formatTime(log.punchIn) : '-';
      const clockOutStr = log.punchOut ? formatTime(log.punchOut) : 'Active Shift';
      const workHrs = log.punchOut ? `${parseFloat(log.totalWorkHours).toFixed(2)} hrs` : '-';
      const breakMins = log.punchOut ? `${Math.round(log.totalBreakMinutes)} mins` : '-';
      
      let statClass = 'status-approved';
      if (log.status === 'Absent' || log.status === 'LWP') statClass = 'status-rejected';
      if (log.status === 'Half Day' || log.status === 'Late Login') statClass = 'status-pending';
      
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${log.email}</strong></td>
        <td>${formatDate(log.date)}</td>
        <td>${log.shiftSlot || '8:30 AM EST'}</td>
        <td>${clockInStr}</td>
        <td>${clockOutStr}</td>
        <td>${workHrs}</td>
        <td>${breakMins}</td>
        <td><span class="status-pill ${statClass}">${log.status}</span></td>
      `;
      attBody.appendChild(row);
    });
  }
}

// Global approval functions bound to window for onclick handlers
window.updateLeaveRequest = async (rowId, newStatus) => {
  const res = await apiCall('updateLeave', { rowId, status: newStatus });
  if (res.success) {
    showNotification(`Leave request ${newStatus.toLowerCase()} successfully.`);
    loadDashboardData();
  } else {
    showNotification(res.error || "Failed to update leave request status", 'error');
  }
};

// --- Leaderboard Compliance Logic (Summary Board) ---
function calculateSummaryBoard() {
  const attendance = state.dashboardData.attendance;
  const breaks = state.dashboardData.breaks;
  const users = state.dashboardData.users;
  
  if (attendance.length === 0 || users.length === 0) {
    return;
  }
  
  const today = getESTTime();
  const currentMonth = today.getMonth(); // 0-indexed
  const currentYear = today.getFullYear();
  
  // Helper to map email to Name
  const getNameByEmail = (email) => {
    const found = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    return found ? found.name : email.split('@')[0];
  };
  
  // Initialize stats metrics for active agents
  const stats = {};
  users.forEach(u => {
    stats[u.email.toLowerCase()] = {
      name: u.name,
      workedDaysMonth: 0,
      absentDaysMonth: 0,
      workedDaysQuarter: 0,
      absentDaysQuarter: 0,
      workedDaysHalf: 0,
      absentDaysHalf: 0,
      workedDaysYear: 0,
      absentDaysYear: 0,
      
      lateLoginsMonth: 0,
      exceededBreaksMonth: 0
    };
  });
  
  // 1. Process Attendance
  attendance.forEach(att => {
    const email = att.email.toLowerCase();
    if (!stats[email]) return;
    
    const attDate = new Date(att.date);
    if (isNaN(attDate.getTime())) return;
    
    const attMonth = attDate.getMonth();
    const attYear = attDate.getFullYear();
    
    if (attYear === currentYear) {
      const isLate = att.status === 'Late Login';
      const isAbsent = att.status === 'Absent' || att.status === 'LWP';
      
      // Monthly checks
      if (attMonth === currentMonth) {
        if (isAbsent) stats[email].absentDaysMonth++;
        else stats[email].workedDaysMonth++;
        
        if (isLate) stats[email].lateLoginsMonth++;
      }
      
      // Quarterly checks (Q1: Jan-Mar (0-2), Q2: Apr-Jun (3-5), Q3: Jul-Sep (6-8), Q4: Oct-Dec (9-11))
      const currentQuarter = Math.floor(currentMonth / 3);
      const attQuarter = Math.floor(attMonth / 3);
      if (attQuarter === currentQuarter) {
        if (isAbsent) stats[email].absentDaysQuarter++;
        else stats[email].workedDaysQuarter++;
      }
      
      // Half Yearly checks (H1: Jan-Jun (0-5), H2: Jul-Dec (6-11))
      const currentHalf = Math.floor(currentMonth / 6);
      const attHalf = Math.floor(attMonth / 6);
      if (attHalf === currentHalf) {
        if (isAbsent) stats[email].absentDaysHalf++;
        else stats[email].workedDaysHalf++;
      }
      
      // Yearly
      if (isAbsent) stats[email].absentDaysYear++;
      else stats[email].workedDaysYear++;
    }
  });
  
  // 2. Process Exceeded Breaks Today/Month
  breaks.forEach(b => {
    const email = b.email.toLowerCase();
    if (!stats[email]) return;
    
    const bDate = new Date(b.date);
    if (isNaN(bDate.getTime())) return;
    
    if (bDate.getFullYear() === currentYear && bDate.getMonth() === currentMonth) {
      const dur = parseFloat(b.breakDurationMinutes || 0);
      let exceeded = false;
      if (b.breakType === 'Tea Break 1' && dur > 15) exceeded = true;
      else if (b.breakType === 'Dinner Break' && dur > 30) exceeded = true;
      else if (b.breakType === 'Tea Break 2' && dur > 15) exceeded = true;
      else if (b.breakType === 'Bio Break' && dur > 5) exceeded = true;
      
      if (exceeded) {
        stats[email].exceededBreaksMonth++;
      }
    }
  });
  
  // Helper to extract best agent (100% compliance criteria)
  const getBestAgent = (filterFn, scoreFn) => {
    let bestAgent = "No Data";
    let maxScore = -1;
    
    Object.keys(stats).forEach(email => {
      const userStat = stats[email];
      if (filterFn(userStat)) {
        const score = scoreFn(userStat);
        if (score > maxScore && score > 0) {
          maxScore = score;
          bestAgent = userStat.name;
        }
      }
    });
    return bestAgent;
  };
  
  // Calculations
  // A. Best Attendance Month (workedDays > 0, absentDays == 0)
  const bestAttM = getBestAgent(u => u.absentDaysMonth === 0, u => u.workedDaysMonth);
  // B. Best Attendance Quarter
  const bestAttQ = getBestAgent(u => u.absentDaysQuarter === 0, u => u.workedDaysQuarter);
  // C. Best Attendance Half Yearly
  const bestAttH = getBestAgent(u => u.absentDaysHalf === 0, u => u.workedDaysHalf);
  // D. Best Attendance Yearly
  const bestAttY = getBestAgent(u => u.absentDaysYear === 0, u => u.workedDaysYear);
  
  // E. Best Agent Punctuality (0 late logins, and worked most days in current month)
  const bestPunct = getBestAgent(u => u.lateLoginsMonth === 0 && u.absentDaysMonth === 0, u => u.workedDaysMonth);
  
  // F. Best Agent Breaks Compliance (0 exceeded breaks, and worked most days in current month)
  const bestBrks = getBestAgent(u => u.exceededBreaksMonth === 0 && u.absentDaysMonth === 0, u => u.workedDaysMonth);
  
  // Write to DOM
  DOM.bestAttMonth.textContent = bestAttM;
  DOM.bestAttQuarter.textContent = bestAttQ;
  DOM.bestAttHalf.textContent = bestAttH;
  DOM.bestAttYear.textContent = bestAttY;
  
  DOM.bestPunctualMonth.textContent = bestPunct;
  DOM.bestBreaksMonth.textContent = bestBrks;
}

// --- Shift Punch In/Out Controllers ---
async function handlePunchAction() {
  const now = new Date();
  const dateStr = getTodayStringEST(); // Server logs in EST dates
  
  if (state.shiftState === 'logged_out') {
    // PUNCH IN
    // Timezone check for weekend block
    const estNow = getESTTime(now);
    const dayOfWeek = estNow.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      const confirmWeekend = confirm("Today is a Weekend Holiday (Saturday/Sunday).\nWould you like to register this shift as Weekend Overtime?");
      if (!confirmWeekend) return;
    }
    
    // Calculate Early Punch In & Late Login Status
    const estHours = estNow.getHours();
    const estMins = estNow.getMinutes();
    const estDecimal = estHours + (estMins / 60);
    let punchStatus = "Present";
    
    if (state.currentUser.shiftSlot === "8:30 AM EST") {
      // Allow punch in up to 1h early (starting at 7:30 AM EST = 7.5h)
      if (estDecimal < 7.5) {
        showNotification("Notice: Punch In is permitted up to 1 hour before your shift (7:30 AM EST).", "warning");
      }
      // 8:30 + 15m grace = 8:45 AM (8.75h) limit
      if (estHours > 8 || (estHours === 8 && estMins > 45)) {
        punchStatus = "Late Login";
      }
    } else if (state.currentUser.shiftSlot === "10:00 AM EST") {
      // Allow punch in up to 1h early (starting at 9:00 AM EST = 9.0h)
      if (estDecimal < 9.0) {
        showNotification("Notice: Punch In is permitted up to 1 hour before your shift (9:00 AM EST).", "warning");
      }
      // 10:00 + 15m grace = 10:15 AM (10.25h) limit
      if (estHours > 10 || (estHours === 10 && estMins > 15)) {
        punchStatus = "Late Login";
      }
    }
    
    const res = await apiCall('punchIn', {
      email: state.currentUser.email,
      timestamp: now.toISOString(),
      date: dateStr,
      status: punchStatus,
      shiftSlot: state.currentUser.shiftSlot
    });
    
    if (res.success) {
      state.shiftState = 'working';
      state.punchInTime = now;
      state.totalBreakMs = 0;
      startActiveTimers();
      
      if (punchStatus === "Late Login") {
        showNotification("Punched In. Flagged: Late Login (Exceeded 15m grace period).", "warning");
      } else {
        showNotification("Punched In successfully! Have a great shift.");
      }
      loadDashboardData();
    } else {
      showNotification(res.error || "Punch In failed", 'error');
    }
    
  } else {
    // PUNCH OUT (End break automatically if active)
    if (state.shiftState === 'on_break' && state.breakStartTime) {
      const activeBreakMinutes = (now - state.breakStartTime) / 60000;
      await apiCall('endBreak', {
        email: state.currentUser.email,
        timestamp: now.toISOString(),
        date: dateStr,
        breakDurationMinutes: activeBreakMinutes
      });
      state.totalBreakMs += (now - state.breakStartTime);
    }
    
    const elapsedShiftMs = now - state.punchInTime;
    const workedHours = (elapsedShiftMs - state.totalBreakMs) / 3600000;
    const breakMinutes = state.totalBreakMs / 60000;
    
    // Categorize today's overall shift status based on NiceRx rules:
    // Work < 4h = Absent, Work >= 4h but < 7h = Half Day, Work >= 8h = Full Day (captured as Present/Late)
    const todayStatus = calculateTodayShiftStatus(workedHours);
    
    const res = await apiCall('punchOut', {
      email: state.currentUser.email,
      timestamp: now.toISOString(),
      date: dateStr,
      totalWorkHours: workedHours.toFixed(4),
      totalBreakMinutes: breakMinutes.toFixed(1),
      status: todayStatus
    });
    
    if (res.success) {
      state.shiftState = 'logged_out';
      state.punchInTime = null;
      state.breakStartTime = null;
      state.totalBreakMs = 0;
      stopActiveTimers();
      showNotification(`Shift completed! Status: ${todayStatus}`);
      loadDashboardData();
    } else {
      showNotification(res.error || "Punch Out failed", 'error');
    }
  }
  
  updateShiftControlUI();
}

function calculateTodayShiftStatus(workedHours, initialPunchStatus = "Present") {
  if (workedHours < 4.0) return "Absent";
  if (workedHours < 7.0) return "Half Day";
  return initialPunchStatus === "Late Login" ? "Late Login" : "Present";
}

// Break manager triggers
async function handleBreakAction() {
  const now = new Date();
  const dateStr = getTodayStringEST();
  const selectedBreakType = DOM.breakTypeSelect.value;
  
  if (state.shiftState === 'working') {
    // START BREAK
    const tb = state.todayBreaks || {};
    let isAlreadyUtilized = false;
    
    if (selectedBreakType === 'Tea Break 1' && tb.tea1Used) isAlreadyUtilized = true;
    else if (selectedBreakType === 'Dinner Break' && tb.dinnerUsed) isAlreadyUtilized = true;
    else if (selectedBreakType === 'Tea Break 2' && tb.tea2Used) isAlreadyUtilized = true;
    else if (selectedBreakType === 'Bio Break' && (tb.bioCount || 0) >= 2) isAlreadyUtilized = true;
    
    if (isAlreadyUtilized) {
      showNotification("You have already utilized this Break Type", "warning");
      return;
    }
    
    const res = await apiCall('startBreak', {
      email: state.currentUser.email,
      timestamp: now.toISOString(),
      date: dateStr,
      breakType: selectedBreakType
    });
    
    if (res.success) {
      state.shiftState = 'on_break';
      state.breakStartTime = now;
      state.currentBreakType = selectedBreakType;
      showNotification(`Active Break: ${selectedBreakType}`);
      loadDashboardData();
    } else {
      showNotification(res.error || "Failed to start break", 'error');
    }
    
  } else if (state.shiftState === 'on_break') {
    // END BREAK
    const activeBreakMinutes = (now - state.breakStartTime) / 60000;
    
    const res = await apiCall('endBreak', {
      email: state.currentUser.email,
      timestamp: now.toISOString(),
      date: dateStr,
      breakDurationMinutes: activeBreakMinutes.toFixed(2)
    });
    
    if (res.success) {
      state.totalBreakMs += (now - state.breakStartTime);
      
      // Notify if limit was exceeded
      let limit = 15;
      if (state.currentBreakType === 'Dinner Break') limit = 30;
      if (state.currentBreakType === 'Bio Break') limit = 5;
      
      if (activeBreakMinutes > limit) {
        showNotification(`Warning: ${state.currentBreakType} exceeded limits (${activeBreakMinutes.toFixed(1)}m / ${limit}m). Highlighted in Red.`, 'warning');
      } else {
        showNotification("Break completed.");
      }
      
      state.shiftState = 'working';
      state.breakStartTime = null;
      state.currentBreakType = null;
      loadDashboardData();
    } else {
      showNotification(res.error || "Failed to end break", 'error');
    }
  }
  
  updateShiftControlUI();
}

function updateShiftControlUI() {
  DOM.breakTimer.className = 'timer-val';
  
  if (state.shiftState === 'logged_out') {
    DOM.shiftStatusText.textContent = "Out of Shift";
    DOM.shiftStatusText.className = "status-value text-muted";
    
    DOM.btnPunch.className = "btn btn-punch btn-success";
    DOM.btnPunchText.textContent = "Punch In";
    
    DOM.breakTypeSelect.disabled = true;
    DOM.btnBreak.disabled = true;
    DOM.btnBreakText.textContent = "Take Break";
    
    DOM.shiftTimer.textContent = "00:00:00";
    DOM.breakTimer.textContent = "00:00:00";
  } 
  else if (state.shiftState === 'working') {
    DOM.shiftStatusText.textContent = "Working";
    DOM.shiftStatusText.className = "status-value text-teal font-bold";
    
    DOM.btnPunch.className = "btn btn-punch btn-danger";
    DOM.btnPunchText.textContent = "Punch Out";
    
    // Lock logic handles break accessibility dynamically based on 2-hour elapsed timer
    DOM.btnBreak.className = "btn btn-break btn-secondary";
    DOM.btnBreakText.textContent = "Start Break";
    DOM.breakTimer.textContent = "00:00:00";
  } 
  else if (state.shiftState === 'on_break') {
    DOM.shiftStatusText.textContent = `On Break (${state.currentBreakType})`;
    DOM.shiftStatusText.className = "status-value text-orange font-bold";
    
    DOM.btnPunch.className = "btn btn-punch btn-danger";
    DOM.btnPunchText.textContent = "Punch Out";
    
    DOM.breakTypeSelect.disabled = true; // Dropdown locked while on break
    DOM.btnBreak.disabled = false;
    DOM.btnBreak.className = "btn btn-break btn-success";
    DOM.btnBreakText.textContent = "Resume Shift";
  }
}

// --- Leave Application Validations ---
async function handleLeaveApplicationSubmit(e) {
  e.preventDefault();
  
  const leaveType = DOM.leaveType.value;
  const startDateStr = DOM.leaveStart.value;
  const endDateStr = DOM.leaveEnd.value;
  const reason = DOM.leaveReason.value.trim();
  const docsSubmitted = DOM.hospitalDocCheckbox.checked;
  
  const sDate = new Date(startDateStr);
  const eDate = new Date(endDateStr);
  const today = getESTTime();
  
  if (sDate > eDate) {
    showNotification("Start date cannot be after end date!", 'error');
    return;
  }
  
  // Calculate consecutive calendar days requested
  const diffDays = Math.round((eDate - sDate) / 86400000) + 1;
  
  // Count notice period (working business days between today and startDate)
  let noticeDays = 0;
  let temp = new Date(today);
  temp.setDate(temp.getDate() + 1); // Start counting from tomorrow
  while (temp < sDate) {
    if (temp.getDay() !== 0 && temp.getDay() !== 6) { // Not Sat/Sun
      noticeDays++;
    }
    temp.setDate(temp.getDate() + 1);
  }
  
  // Count business days of leave requested
  let leaveWorkingDays = 0;
  let tempL = new Date(sDate);
  while (tempL <= eDate) {
    if (tempL.getDay() !== 0 && tempL.getDay() !== 6) {
      leaveWorkingDays++;
    }
    tempL.setDate(tempL.getDate() + 1);
  }
  
  // 1. Earned Leave (EL) validation rules
  if (leaveType === "Earned Leave (EL)") {
    // Check available EL balance
    if (leaveWorkingDays > state.currentUser.earnedLeavesAvailable) {
      const applyLWP = confirm(`Insufficient EL balance (${state.currentUser.earnedLeavesAvailable} available vs ${leaveWorkingDays} requested).\nWould you like to automatically convert this request to Leave Without Pay (LWP)?`);
      if (applyLWP) {
        submitLeaveRequest("Leave Without Pay (LWP)", startDateStr, endDateStr, reason, docsSubmitted);
      }
      return;
    }
    
    // Notice periods checks
    if (diffDays <= 2) {
      if (noticeDays < 2) {
        showNotification("Policy Block: Earned Leaves of 2 days or less require a minimum 2 working days' advance notice.", "error");
        return;
      }
    } else {
      if (noticeDays < 7) {
        showNotification("Policy Block: Earned Leaves exceeding 2 days require a minimum 7 working days' advance notice.", "error");
        return;
      }
    }
    
    // Block applying for EL if immediate previous business day was Absent or had a leave
    const prevBizDate = getPreviousBusinessDayDateStr(sDate);
    const prevAtt = state.dashboardData.attendance.find(a => a.date === prevBizDate);
    
    if (prevAtt && (prevAtt.status === 'Absent' || prevAtt.status === 'LWP')) {
      showNotification("Policy Block: Earned Leave cannot be applied immediately following an Absent day. Converted to LWP.", "error");
      submitLeaveRequest("Leave Without Pay (LWP)", startDateStr, endDateStr, reason, docsSubmitted);
      return;
    }
  }
  
  // 2. Sick Leave (SL) validation rules
  if (leaveType === "Sick Leave (SL)") {
    if (leaveWorkingDays > state.currentUser.sickLeavesAvailable) {
      const applyLWP = confirm(`Insufficient SL balance (${state.currentUser.sickLeavesAvailable} available).\nConvert this application to Leave Without Pay (LWP)?`);
      if (applyLWP) {
        submitLeaveRequest("Leave Without Pay (LWP)", startDateStr, endDateStr, reason, docsSubmitted);
      }
      return;
    }
    
    // Must apply on the immediate next business day. Block application from the second business day.
    const immediateNextBizDayOfLeave = getNextBusinessDayDateStr(eDate);
    const todayStr = getTodayStringEST();
    
    if (todayStr !== immediateNextBizDayOfLeave) {
      showNotification("Policy Block: Sick Leave must be applied on the immediate next business day following illness.", "error");
      return;
    }
  }
  
  // 3. Half-Day Sick Leave (HDSL) and Half-Day LWP (HDLWP)
  if (leaveType === "Half-day sick leave (HDSL)" || leaveType === "Half-day leave without pay (HDLWP)") {
    // Check if they have completed 4 hours of logged-in shift time today
    // We look up today's active work duration if they are applying for today
    const todayStr = getTodayStringEST();
    if (startDateStr === todayStr) {
      if (state.shiftState === 'logged_out') {
        showNotification("Policy Block: Half-Day leaves can only be applied after logging in and completing 4 hours of shift.", "error");
        return;
      }
      const elapsedShiftMs = new Date() - state.punchInTime;
      const workedMins = (elapsedShiftMs - state.totalBreakMs) / 60000;
      if (workedMins < 240) { // 4 hours = 240 mins
        showNotification(`Policy Block: Completed work is ${(workedMins/60).toFixed(2)} hours. A minimum of 4 hours is required to apply for Half-Day.`, "error");
        return;
      }
    } else {
      // Historical or future check
      const targetAtt = state.dashboardData.attendance.find(a => a.date === startDateStr);
      if (!targetAtt || parseFloat(targetAtt.totalWorkHours) < 4.0) {
        showNotification("Policy Block: A minimum of 4 working hours must be logged on the target date to qualify for Half-Day leave.", "error");
        return;
      }
    }
  }
  
  // 4. Maternity Leave (MTL)
  if (leaveType === "Maternity Leave (MTL)") {
    if (noticeDays < 7) {
      showNotification("Policy Block: Maternity Leave requires a minimum of 7 working days' advance notice.", "error");
      return;
    }
  }
  
  // 5. Hospital Leave (HL)
  if (leaveType === "Hospital Leave (HL)") {
    if (!docsSubmitted) {
      showNotification("Policy Block: Hospital Leave requires hospital documentation submission checkbox to be checked.", "error");
      return;
    }
  }
  
  // All validations passed, submit request
  submitLeaveRequest(leaveType, startDateStr, endDateStr, reason, docsSubmitted);
}

async function submitLeaveRequest(leaveType, startDate, endDate, reason, docsSubmitted) {
  const res = await apiCall('applyLeave', {
    email: state.currentUser.email,
    leaveType,
    startDate,
    endDate,
    reason,
    docsSubmitted
  });
  
  if (res.success) {
    showNotification("Leave request submitted successfully!");
    DOM.leaveForm.reset();
    DOM.hospitalDocGroup.classList.add('hidden');
    loadDashboardData();
  } else {
    showNotification(res.error || "Leave application failed", 'error');
  }
}

// --- Date/Time Math and Helper Functions ---
function getPreviousBusinessDayDateStr(dateObj) {
  let temp = new Date(dateObj);
  temp.setDate(temp.getDate() - 1);
  while (temp.getDay() === 0 || temp.getDay() === 6) { // Skip Sat/Sun
    temp.setDate(temp.getDate() - 1);
  }
  return temp.toISOString().split('T')[0];
}

function getNextBusinessDayDateStr(dateObj) {
  let temp = new Date(dateObj);
  temp.setDate(temp.getDate() + 1);
  while (temp.getDay() === 0 || temp.getDay() === 6) { // Skip Sat/Sun
    temp.setDate(temp.getDate() + 1);
  }
  return temp.toISOString().split('T')[0];
}

function getTodayStringEST() {
  const d = getESTTime();
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDurationMs(ms) {
  if (ms < 0) ms = 0;
  const secs = Math.floor(ms / 1000) % 60;
  const mins = Math.floor(ms / 60000) % 60;
  const hrs = Math.floor(ms / 3600000);
  return [
    hrs.toString().padStart(2, '0'),
    mins.toString().padStart(2, '0'),
    secs.toString().padStart(2, '0')
  ].join(':');
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const str = dateString.toString().trim();
  
  // Directly parse YYYY-MM-DD to avoid UTC vs Local timezone shifts in Safari/Firefox/Chrome/Edge
  if (typeof str === 'string' && str.match(/^\d{4}-\d{2}-\d{2}/)) {
    const parts = str.split('T')[0].split('-');
    if (parts.length === 3) {
      const y = parts[0];
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      if (m >= 0 && m < 12) {
        return `${months[m]} ${d}, ${y}`;
      }
    }
  }
  
  const d = new Date(str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function truncateString(str, length) {
  if (!str) return '';
  if (str.length <= length) return str;
  return str.substring(0, length) + '...';
}

// --- Admin Report Export compilation and CSV download handler ---
function handleExportReportAction() {
  const selectedAgent = DOM.exportAgentSelect.value;
  const exportMode = DOM.exportModeSelect ? DOM.exportModeSelect.value : 'month';
  let start, end, filenameSuffix;
  
  if (exportMode === 'month') {
    const selectedYear = parseInt(DOM.exportYearSelect.value);
    const startMonth = parseInt(DOM.exportStartMonth.value);
    const endMonth = parseInt(DOM.exportEndMonth.value);
    
    if (startMonth > endMonth) {
      showNotification("From Month cannot be after To Month.", "error");
      return;
    }
    
    start = new Date(selectedYear, startMonth, 1);
    end = new Date(selectedYear, endMonth + 1, 0, 23, 59, 59);
    
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    filenameSuffix = `${monthNames[startMonth]}_to_${monthNames[endMonth]}_${selectedYear}`;
  } else {
    const startDateStr = DOM.exportStartDate.value;
    const endDateStr = DOM.exportEndDate.value;
    
    if (!startDateStr || !endDateStr) {
      showNotification("Start and End dates are required for export.", "error");
      return;
    }
    
    start = new Date(startDateStr);
    end = new Date(endDateStr);
    end.setHours(23, 59, 59, 999);
    
    if (start > end) {
      showNotification("Start date cannot be after end date.", "error");
      return;
    }
    filenameSuffix = `${startDateStr}_to_${endDateStr}`;
  }
  
  // Filter attendance logs
  let logs = state.dashboardData.attendance;
  
  if (selectedAgent !== "All Agents") {
    logs = logs.filter(l => l.email.toLowerCase() === selectedAgent.toLowerCase());
  }
  
  logs = logs.filter(l => {
    const d = new Date(l.date);
    return d >= start && d <= end;
  });
  
  if (logs.length === 0) {
    showNotification("No attendance records found for the selected period/agent.", "warning");
    return;
  }
  
  // Convert to CSV string
  let csvContent = "Agent Name,Agent Email,Date,Shift Slot,Clock In (IST),Clock Out (IST),Worked Hours,Break Minutes,Status\n";
  
  logs.forEach(l => {
    const agentName = getAgentNameByEmail(l.email);
    const clockInStr = l.punchIn ? formatTime(l.punchIn).replace(/,/g, "") : "-";
    const clockOutStr = l.punchOut ? formatTime(l.punchOut).replace(/,/g, "") : "Active Shift";
    const workHrs = l.punchOut ? parseFloat(l.totalWorkHours).toFixed(2) : "-";
    const breakMins = l.punchOut ? Math.round(l.totalBreakMinutes) : "-";
    
    const nameEscaped = agentName.replace(/"/g, '""');
    
    csvContent += `"${nameEscaped}",${l.email},${l.date},"${l.shiftSlot || '8:30 AM EST'}",${clockInStr},${clockOutStr},${workHrs},${breakMins},${l.status}\n`;
  });
  
  // Trigger file download in browser
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  
  const agentFilename = selectedAgent === "All Agents" ? "Team" : selectedAgent.split('@')[0];
  link.setAttribute("download", `NiceRx_Attendance_Report_${agentFilename}_${filenameSuffix}.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  DOM.exportModal.classList.add('hidden');
  showNotification("Report downloaded successfully!");
}

function getAgentNameByEmail(email) {
  const found = state.dashboardData.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  return found ? found.name : email.split('@')[0];
}
