import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import {
  PlusCircle,
  RotateCcw,
  Lock,
  X,
  LogOut,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Phone,
  Trash2,
  Send,
  Calendar,
  Clock,
  WifiOff
} from 'lucide-react';
import logo from './assets/logo.png';
import './index.css';

const API_BASE_URL = 'https://task-management-tp39.onrender.com';
const WA_BASE_URL = 'http://localhost:3001';
const PROGRAM_ORDER = ['HO HYDREABAD', 'Youth', 'PwD', 'Mitra/ACE', 'KARV'];
const RAISED_BY_COL = "Emp Id";
const ATTENDANCE_COL = "Request Type";
const LEAVE_COL = "Leave Type";
const ADMIN_USER = "admin";
const ADMIN_PASS = "drf@2026";

const isBusinessHour = (date) => {
  const h = date.getHours();
  return h >= 8 && h < 22;
};

const localDateTimeString = (date) => {
  const pad = n => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function App() {
  const [data, setData] = useState([]);
  const [empMap, setEmpMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [currentMode, setCurrentMode] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [loginForm, setLoginForm] = useState({ user: '', pass: '' });
  const [selectedBreakdown, setSelectedBreakdown] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [showPhoneManager, setShowPhoneManager] = useState(false);
  const [phoneBook, setPhoneBook] = useState(() => {
    try { return JSON.parse(localStorage.getItem('drf_phonebook') || '{}'); }
    catch { return {}; }
  });
  const [phoneForm, setPhoneForm] = useState({ member: '', phone: '' });

  const [showWAModal, setShowWAModal] = useState(false);
  const [waStatus, setWaStatus] = useState(null);
  const [selectedMembers, setSelectedMembers] = useState(new Set());
  const [waMode, setWaMode] = useState('now');
  const [scheduleTime, setScheduleTime] = useState('');
  const [sendingWA, setSendingWA] = useState(false);

  const [showSchedules, setShowSchedules] = useState(false);
  const [scheduledJobs, setScheduledJobs] = useState([]);

  const fileInputRef = useRef(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [dashRes, mapRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/dashboard`),
        axios.get(`${API_BASE_URL}/emp-map`)
      ]);
      setData(dashRes.data);
      setEmpMap(mapRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setTimeout(() => setLoading(false), 500);
    }
  };

  const fetchBreakdown = async (member) => {
    if (breakdownLoading) return;
    setBreakdownLoading(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/breakdown/${encodeURIComponent(member)}`);
      setSelectedBreakdown({ member, data: res.data });
      setShowBreakdown(true);
    } catch (error) {
      console.error('Error fetching breakdown:', error);
    } finally {
      setBreakdownLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const totalTasks = data.reduce((acc, curr) => acc + curr.pending_count, 0);
  const lastUpdateRaw = data.reduce((latest, item) => {
    if (!item.last_updated) return latest;
    const d = new Date(item.last_updated);
    return !latest || d > latest ? d : latest;
  }, null);

  const generateHash = async (file) => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (loginForm.user === ADMIN_USER && loginForm.pass === ADMIN_PASS) {
      setIsLoggedIn(true);
      setShowLogin(false);
      setLoginForm({ user: '', pass: '' });
    } else {
      alert("Invalid credentials");
    }
  };

  const initiateUpload = (mode) => {
    if (!isLoggedIn) return;
    if (mode === 'reset' && !window.confirm("This will wipe all existing data. Are you sure?")) return;
    setCurrentMode(mode);
    fileInputRef.current.click();
  };

  const parseFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const jsonData = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        if (jsonData.length === 0) { reject(new Error('File is empty')); return; }

        const memberCounts = {};
        const breakdownData = {};
        let detectedSheetType = null;

        if (jsonData[0][ATTENDANCE_COL]) detectedSheetType = "attendance";
        else if (jsonData[0][LEAVE_COL]) detectedSheetType = "leave";

        jsonData.forEach(row => {
          const empId = (row["Employees ID"] || row["Emp Id"] || row[RAISED_BY_COL])?.toString().trim();
          const empName = row["Name"]?.toString().trim();
          const memberName = empMap[empId] || empMap[empName];
          if (memberName) {
            memberCounts[memberName] = (memberCounts[memberName] || 0) + 1;
            if (detectedSheetType) {
              if (!breakdownData[memberName])
                breakdownData[memberName] = { sheet_type: detectedSheetType, types: {} };
              const rType = row[detectedSheetType === "attendance" ? ATTENDANCE_COL : LEAVE_COL]?.toString().trim();
              if (rType)
                breakdownData[memberName].types[rType] = (breakdownData[memberName].types[rType] || 0) + 1;
            }
          }
        });

        if (Object.keys(memberCounts).length === 0) {
          reject(new Error(`No matching employees found in "${file.name}"`));
          return;
        }
        resolve({ memberCounts, breakdownData });
      } catch (err) { reject(err); }
    };
    reader.readAsArrayBuffer(file);
  });

  const handleFileUpload = async (event) => {
    const files = Array.from(event.target.files);
    const mode = currentMode;
    if (!files.length || !mode) return;

    setLoading(true);
    setMessage(null);
    let succeeded = 0, duplicates = 0, failed = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileMode = (mode === 'reset' && i === 0) ? 'reset' : 'add';
      try {
        const [fileHash, parsed] = await Promise.all([generateHash(file), parseFile(file)]);
        await axios.post(`${API_BASE_URL}/upload-counts`, {
          counts: parsed.memberCounts,
          file_name: file.name,
          file_hash: fileHash,
          mode: fileMode,
          breakdown: parsed.breakdownData
        });
        succeeded++;
      } catch (error) {
        if (error.response?.status === 400) duplicates++;
        else if (error.message) {
          setMessage({ type: 'error', text: error.message });
          setLoading(false);
          event.target.value = null;
          setCurrentMode(null);
          return;
        } else failed++;
      }
    }

    const total = files.length;
    if (succeeded === total) {
      setMessage({ type: 'success', text: total === 1 ? 'File uploaded successfully' : `${total} files uploaded successfully` });
    } else if (duplicates === total) {
      setMessage({ type: 'warning', text: total === 1 ? 'This file has already been uploaded' : 'All files have already been uploaded' });
    } else if (succeeded > 0) {
      const parts = [`${succeeded} uploaded`];
      if (duplicates) parts.push(`${duplicates} duplicate${duplicates > 1 ? 's' : ''} skipped`);
      if (failed) parts.push(`${failed} failed`);
      setMessage({ type: 'warning', text: parts.join(', ') });
    } else {
      setMessage({ type: 'error', text: 'Upload failed. Please try again' });
    }

    fetchData();
    event.target.value = null;
    setCurrentMode(null);
  };

  const savePhone = () => {
    const { member, phone } = phoneForm;
    if (!member || !phone) return;
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length < 10) return;
    const updated = { ...phoneBook, [member]: cleaned };
    setPhoneBook(updated);
    localStorage.setItem('drf_phonebook', JSON.stringify(updated));
    setPhoneForm({ member: '', phone: '' });
  };

  const deletePhone = (member) => {
    const updated = { ...phoneBook };
    delete updated[member];
    setPhoneBook(updated);
    localStorage.setItem('drf_phonebook', JSON.stringify(updated));
  };

  const openWAModal = async () => {
    let status = { ready: false };
    try {
      const res = await axios.get(`${WA_BASE_URL}/status`);
      status = res.data;
    } catch {}
    setWaStatus(status);
    const withPhones = new Set(
      data.filter(item => phoneBook[item.dashboard_member]).map(item => item.dashboard_member)
    );
    setSelectedMembers(withPhones);
    setWaMode('now');
    setScheduleTime(localDateTimeString(new Date(Date.now() + 3600000)));
    setShowWAModal(true);
  };

  const toggleMember = (name) => {
    setSelectedMembers(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const selectAllMembers = () =>
    setSelectedMembers(new Set(data.filter(i => phoneBook[i.dashboard_member]).map(i => i.dashboard_member)));

  const deselectAllMembers = () => setSelectedMembers(new Set());

  const buildRecipients = () =>
    data
      .filter(item => selectedMembers.has(item.dashboard_member) && phoneBook[item.dashboard_member])
      .map(item => ({
        name: item.dashboard_member,
        phone: phoneBook[item.dashboard_member],
        message: `Hi ${item.dashboard_member}, your team has ${item.pending_count} pending task${item.pending_count !== 1 ? 's' : ''} as of ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. Please action them at the earliest.`
      }));

  const handleWASend = async () => {
    const recipients = buildRecipients();
    if (recipients.length === 0) {
      setMessage({ type: 'warning', text: 'Select at least one member with a saved number' });
      return;
    }

    if (waMode === 'now') {
      setSendingWA(true);
      try {
        await axios.post(`${WA_BASE_URL}/send-bulk`, { recipients });
        setMessage({ type: 'success', text: `WhatsApp updates queued for ${recipients.length} member${recipients.length !== 1 ? 's' : ''}` });
        setShowWAModal(false);
      } catch {
        setMessage({ type: 'error', text: 'WhatsApp service not reachable. Is it running?' });
      } finally {
        setSendingWA(false);
      }
    } else {
      const fireDate = new Date(scheduleTime);
      if (!isBusinessHour(fireDate)) {
        if (!window.confirm(`${fireDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} is outside business hours (8am–10pm). Schedule anyway?`)) return;
      }
      try {
        await axios.post(`${WA_BASE_URL}/schedule`, {
          recipients,
          scheduledFor: fireDate.toISOString()
        });
        setMessage({ type: 'success', text: `Scheduled for ${fireDate.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })}` });
        setShowWAModal(false);
      } catch (err) {
        setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to schedule' });
      }
    }
  };

  const openSchedules = async () => {
    try {
      const res = await axios.get(`${WA_BASE_URL}/schedules`);
      setScheduledJobs(res.data);
    } catch {
      setScheduledJobs([]);
    }
    setShowSchedules(true);
  };

  const cancelScheduledJob = async (id) => {
    try {
      await axios.delete(`${WA_BASE_URL}/schedules/${id}`);
      setScheduledJobs(prev => prev.filter(j => j.id !== id));
      setMessage({ type: 'success', text: 'Scheduled send cancelled' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to cancel job' });
    }
  };

  const statusColors = (count) => {
    if (count === 0) return { status: 'status-green', text: 'text-green' };
    if (count <= 20) return { status: 'status-amber', text: 'text-amber' };
    return { status: 'status-red', text: 'text-red' };
  };

  const formatDate = (date) => {
    if (!date) return 'Never';
    return new Date(date).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
      timeZone: 'Asia/Kolkata'
    }).replace(',', ' |');
  };

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const SkeletonCard = () => (
    <div className="member-card">
      <div className="skeleton skeleton-text"></div>
      <div className="skeleton skeleton-count"></div>
      <div className="skeleton skeleton-footer"></div>
    </div>
  );

  const membersWithPhone = data.filter(item => phoneBook[item.dashboard_member]);
  const membersWithoutPhone = data.filter(item => !phoneBook[item.dashboard_member]);
  const minDateTime = localDateTimeString(new Date(Date.now() + 60000));

  return (
    <div className="app-root">
      {message && (
        <div className={`message-toast ${message.type}`}>
          {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          {message.text}
          <button onClick={() => setMessage(null)} className="close-msg">×</button>
        </div>
      )}

      {/* Breakdown Modal */}
      {showBreakdown && selectedBreakdown && (
        <div className="modal-overlay" onClick={() => setShowBreakdown(false)}>
          <div className="breakdown-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{selectedBreakdown.member}</h2>
              <X className="cursor-pointer" onClick={() => setShowBreakdown(false)} />
            </div>
            <div className="modal-content">
              {Object.keys(selectedBreakdown.data.attendance).length > 0 && (
                <div className="breakdown-section">
                  <h3>Attendance Breakdown</h3>
                  <table className="breakdown-table">
                    <thead><tr><th>Request Type</th><th>Count</th></tr></thead>
                    <tbody>
                      {Object.entries(selectedBreakdown.data.attendance).map(([type, count]) => (
                        <tr key={type}><td>{type}</td><td>{count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {Object.keys(selectedBreakdown.data.leave).length > 0 && (
                <div className="breakdown-section">
                  <h3>Leave Breakdown</h3>
                  <table className="breakdown-table">
                    <thead><tr><th>Leave Type</th><th>Count</th></tr></thead>
                    <tbody>
                      {Object.entries(selectedBreakdown.data.leave).map(([type, count]) => (
                        <tr key={type}><td>{type}</td><td>{count}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {Object.keys(selectedBreakdown.data.attendance).length === 0 &&
               Object.keys(selectedBreakdown.data.leave).length === 0 && (
                <div className="no-data-msg">No breakdown data available for this member.</div>
              )}
            </div>
            <button className="login-btn" onClick={() => setShowBreakdown(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Login Modal */}
      {showLogin && (
        <div className="modal-overlay">
          <form className="login-modal" onSubmit={handleLogin}>
            <div style={{ position: 'relative' }}>
              <X className="cursor-pointer text-muted"
                 style={{ position: 'absolute', right: '-1.5rem', top: '-1.5rem', cursor: 'pointer' }}
                 onClick={() => setShowLogin(false)} />
              <img src={logo} alt="DRF Logo" className="modal-logo" />
              <h2 style={{ marginBottom: '1.5rem', color: '#1e293b' }}>Admin Access</h2>
            </div>
            <div className="form-group">
              <label>Username</label>
              <input type="text" value={loginForm.user} onChange={e => setLoginForm({...loginForm, user: e.target.value})} placeholder="Enter username" required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={loginForm.pass} onChange={e => setLoginForm({...loginForm, pass: e.target.value})} placeholder="Enter password" required />
            </div>
            <button type="submit" className="login-btn">Secure Login</button>
          </form>
        </div>
      )}

      {/* Phone Manager Modal */}
      {showPhoneManager && (
        <div className="modal-overlay" onClick={() => setShowPhoneManager(false)}>
          <div className="phone-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Manage WhatsApp Numbers</h2>
              <X className="cursor-pointer" onClick={() => setShowPhoneManager(false)} />
            </div>
            <div className="phone-form">
              <select value={phoneForm.member} onChange={e => setPhoneForm({ ...phoneForm, member: e.target.value })} className="phone-select">
                <option value="">Select member</option>
                {data.map(item => (
                  <option key={item.dashboard_member} value={item.dashboard_member}>{item.dashboard_member}</option>
                ))}
              </select>
              <input type="tel" placeholder="91XXXXXXXXXX" value={phoneForm.phone} onChange={e => setPhoneForm({ ...phoneForm, phone: e.target.value })} className="phone-input" />
              <button className="phone-save-btn" onClick={savePhone}><Phone size={14} /> Save</button>
            </div>
            <div className="phone-list">
              {Object.keys(phoneBook).length === 0 ? (
                <div className="no-data-msg">No numbers saved yet.</div>
              ) : (
                Object.entries(phoneBook).map(([member, phone]) => (
                  <div key={member} className="phone-list-item">
                    <div>
                      <div className="phone-member-name">{member}</div>
                      <div className="phone-number">+{phone}</div>
                    </div>
                    <Trash2 size={16} className="delete-phone" onClick={() => deletePhone(member)} />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Send Modal */}
      {showWAModal && (
        <div className="modal-overlay" onClick={() => setShowWAModal(false)}>
          <div className="wa-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Send WhatsApp Updates</h2>
              <X className="cursor-pointer" onClick={() => setShowWAModal(false)} />
            </div>

            <div className={`wa-status-bar ${waStatus?.ready ? 'connected' : 'disconnected'}`}>
              {waStatus?.ready
                ? <><span className="wa-dot connected" />Connected</>
                : <><WifiOff size={14} />Disconnected — messages will fail until WhatsApp is reconnected</>
              }
            </div>

            <div className="wa-section-label">
              Recipients
              <div className="wa-select-controls">
                <button className="wa-ctrl-btn" onClick={selectAllMembers}>All</button>
                <button className="wa-ctrl-btn" onClick={deselectAllMembers}>None</button>
              </div>
            </div>

            <div className="wa-member-list">
              {membersWithPhone.map(item => (
                <label key={item.dashboard_member} className="wa-member-item">
                  <input
                    type="checkbox"
                    checked={selectedMembers.has(item.dashboard_member)}
                    onChange={() => toggleMember(item.dashboard_member)}
                  />
                  <span className="wa-member-name">{item.dashboard_member}</span>
                  <span className="wa-phone-tag">+{phoneBook[item.dashboard_member]}</span>
                </label>
              ))}
              {membersWithoutPhone.map(item => (
                <div key={item.dashboard_member} className="wa-member-item disabled">
                  <input type="checkbox" disabled />
                  <span className="wa-member-name">{item.dashboard_member}</span>
                  <span className="wa-phone-tag no-phone">no number</span>
                </div>
              ))}
            </div>

            <div className="wa-mode-toggle">
              <label className={waMode === 'now' ? 'active' : ''}>
                <input type="radio" value="now" checked={waMode === 'now'} onChange={() => setWaMode('now')} />
                <Send size={13} /> Send Now
              </label>
              <label className={waMode === 'later' ? 'active' : ''}>
                <input type="radio" value="later" checked={waMode === 'later'} onChange={() => setWaMode('later')} />
                <Clock size={13} /> Schedule
              </label>
            </div>

            {waMode === 'later' && (
              <div className="wa-datetime-row">
                <label>Send at</label>
                <input
                  type="datetime-local"
                  value={scheduleTime}
                  min={minDateTime}
                  onChange={e => setScheduleTime(e.target.value)}
                  className="wa-datetime-input"
                />
              </div>
            )}

            <div className="wa-modal-footer">
              <button className="wa-cancel-btn" onClick={() => setShowWAModal(false)}>Cancel</button>
              <button
                className="wa-send-btn"
                onClick={handleWASend}
                disabled={sendingWA || selectedMembers.size === 0}
              >
                {sendingWA
                  ? <><Send size={13} className="spin" /> Sending...</>
                  : waMode === 'now'
                    ? <><Send size={13} /> Send to {selectedMembers.size}</>
                    : <><Calendar size={13} /> Schedule for {selectedMembers.size}</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scheduled Jobs Modal */}
      {showSchedules && (
        <div className="modal-overlay" onClick={() => setShowSchedules(false)}>
          <div className="phone-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Scheduled Sends</h2>
              <X className="cursor-pointer" onClick={() => setShowSchedules(false)} />
            </div>
            <div className="phone-list">
              {scheduledJobs.length === 0 ? (
                <div className="no-data-msg">No scheduled sends.</div>
              ) : (
                scheduledJobs.map(job => (
                  <div key={job.id} className="schedule-item">
                    <div>
                      <div className="schedule-time">
                        <Clock size={13} />
                        {new Date(job.scheduledFor).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                      </div>
                      <div className="schedule-meta">
                        {job.recipients.length} recipient{job.recipients.length !== 1 ? 's' : ''}
                        {' · '}
                        <span className={`schedule-status ${job.status}`}>{job.status}</span>
                      </div>
                    </div>
                    {job.status === 'pending' && (
                      <button className="cancel-schedule-btn" onClick={() => cancelScheduledJob(job.id)}>Cancel</button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="header-wrapper">
        <header>
          <div className="header-left">
            <img src={logo} alt="DRF" className="brand-logo" />
            <div className="brand-info">
              <h1>PENDING TASKS DASHBOARD - DARWIN BOX</h1>
            </div>
          </div>
          <div className="header-right">
            <div className="refreshed-at">
              Refreshed: {formatDate(lastUpdateRaw)}
              <button className="refresh-btn" onClick={fetchData} disabled={loading} title="Refresh now">
                <RotateCcw size={12} className={loading ? 'spin' : ''} />
              </button>
            </div>
            <div className="auth-actions">
              {isLoggedIn ? (
                <>
                  <button className="upload-btn" onClick={() => initiateUpload('add')}><PlusCircle size={14} /> Add Report</button>
                  <button className="upload-btn reset" onClick={() => initiateUpload('reset')}><RotateCcw size={14} /> Reset & Upload</button>
                  <button className="upload-btn wa" onClick={() => setShowPhoneManager(true)}><Phone size={14} /> Numbers</button>
                  <button className="upload-btn wa-send" onClick={openWAModal}><MessageSquare size={14} /> Send WA</button>
                  <button className="upload-btn schedules" onClick={openSchedules}><Calendar size={14} /> Schedules</button>
                  <LogOut size={16} className="logout-link" onClick={() => setIsLoggedIn(false)} />
                </>
              ) : (
                <button className="lock-btn" onClick={() => setShowLogin(true)}><Lock size={18} /></button>
              )}
            </div>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".xlsx, .xls, .csv" multiple style={{ display: 'none' }} />
          </div>
        </header>
      </div>

      <div className="dashboard-container">
        <div className="summary-banner">
          <div className="summary-total-row">
            <span className="summary-total-label">Total Pending Tasks(Attendence and leave Requests)</span>
            <span className="summary-total-value">{loading ? '...' : totalTasks}</span>
            <div className="summary-divider" />
          </div>
          <div className="summary-sections-row">
            {PROGRAM_ORDER.map(prog => {
              const progData = data.filter(item => (item.program || 'Other') === prog);
              if (progData.length === 0) return null;
              const count = progData.reduce((sum, item) => sum + item.pending_count, 0);
              return (
                <div key={prog} className="summary-section-box">
                  <span className="summary-section-name">{prog}</span>
                  <span className="summary-section-count">{loading ? '...' : count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="cards-grid">
            {Array(12).fill(0).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          (() => {
            const grouped = {};
            data.forEach(item => {
              const prog = item.program || 'Other';
              if (!grouped[prog]) grouped[prog] = [];
              grouped[prog].push(item);
            });

            const renderSection = (prog) => {
              if (!grouped[prog]) return null;
              const total = grouped[prog].reduce((sum, item) => sum + item.pending_count, 0);
              const sorted = [...grouped[prog]].sort((a, b) => b.pending_count - a.pending_count);
              return (
                <div key={prog} className="section">
                  <div className="section-header">
                    <span className="section-title">{prog}</span>
                    <span className="section-badge">{total} pending</span>
                  </div>
                  <div className="section-cards">
                    {sorted.map(item => {
                      const styles = statusColors(item.pending_count);
                      return (
                        <div
                          key={item.dashboard_member}
                          className={`member-card ${styles.status} ${breakdownLoading ? 'pointer-events-none' : ''}`}
                          onClick={() => fetchBreakdown(item.dashboard_member)}
                        >
                          <div className="card-tooltip">Updated: {formatDate(item.last_updated)}</div>
                          <div className="member-name">{item.dashboard_member}</div>
                          <div className={`card-count ${styles.text}`}>{item.pending_count}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            };

            return (
              <div className="sections-container">
                {renderSection('HO HYDREABAD')}
                {renderSection('Youth')}
                {renderSection('PwD')}
                {renderSection('Mitra/ACE')}
                {renderSection('KARV')}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}

export default App;
