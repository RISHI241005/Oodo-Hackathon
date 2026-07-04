const root = document.getElementById("root");
const toast = document.getElementById("toast");

const state = {
  token: localStorage.getItem("hrms_token") || "",
  user: null,
  profile: null,
  employees: [],
  activeTab: "dashboard",
  selectedEmployeeId: null
};

const tabs = [
  ["dashboard", "Dashboard"],
  ["profile", "Profile"],
  ["attendance", "Attendance"],
  ["leave", "Leave"],
  ["payroll", "Payroll"],
  ["employees", "Employees"]
];

function isAdmin() {
  return state.user && ["admin", "hr"].includes(state.user.role);
}

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function notify(message) {
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function money(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : "";
}

function initials(name) {
  return String(name || "HR").split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function boot() {
  if (!state.token) {
    renderAuth("signin");
    return;
  }
  try {
    const data = await api("/api/me");
    state.user = data.user;
    state.profile = data.profile;
    state.selectedEmployeeId = state.user.employeeId;
    await loadEmployees();
    renderShell();
    await renderTab();
  } catch {
    localStorage.removeItem("hrms_token");
    state.token = "";
    renderAuth("signin");
  }
}

function renderAuth(mode) {
  root.innerHTML = `
    <main class="auth-page">
      <section class="auth-panel">
        <div class="brand">
          <img src="/hrms-mark.svg" alt="">
          <span>HRMS Live</span>
        </div>
        <div class="auth-tabs">
          <button class="${mode === "signin" ? "active" : ""}" data-auth-tab="signin">Sign In</button>
          <button class="${mode === "signup" ? "active" : ""}" data-auth-tab="signup">Sign Up</button>
        </div>
        ${mode === "signin" ? signinForm() : signupForm()}
      </section>
      <section class="auth-visual">
        <h1>Every workday, perfectly aligned.</h1>
        <p>Profiles, attendance, leave approvals, and payroll stay connected through live API calls and MySQL updates.</p>
      </section>
    </main>
  `;
}

function signinForm() {
  return `
    <form class="form-grid" data-form="signin">
      <label>Email <input name="email" type="email" value="admin@hrms.local" required></label>
      <label>Password <input name="password" type="password" value="Admin@12345" required></label>
      <button type="submit">Sign In</button>
    </form>
  `;
}

function signupForm() {
  return `
    <form class="form-grid" data-form="signup">
      <div class="two">
        <label>Employee ID <input name="employeeCode" placeholder="EMP-102" required></label>
        <label>Role
          <select name="role">
            <option value="employee">Employee</option>
            <option value="hr">HR</option>
          </select>
        </label>
      </div>
      <label>Full Name <input name="fullName" required></label>
      <label>Email <input name="email" type="email" required></label>
      <label>Password <input name="password" type="password" required></label>
      <div class="two">
        <label>Department <input name="department" value="Engineering"></label>
        <label>Designation <input name="designation" value="Employee"></label>
      </div>
      <button type="submit">Create Account</button>
    </form>
  `;
}

function renderShell() {
  const availableTabs = tabs.filter(([id]) => isAdmin() || id !== "employees");
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <img src="/hrms-mark.svg" alt="">
          <span>HRMS Live</span>
        </div>
        <div class="identity">
          <div class="avatar">${escapeHtml(initials(state.user.fullName))}</div>
          <div>
            <strong>${escapeHtml(state.user.fullName)}</strong>
            <div class="muted">${escapeHtml(state.user.employeeCode)} - ${escapeHtml(state.user.role.toUpperCase())}</div>
          </div>
          <button class="secondary" data-action="signout">Sign Out</button>
        </div>
      </header>
      <div class="workspace">
        <aside class="sidebar">
          <nav class="nav">
            ${availableTabs.map(([id, label]) => `<button class="${state.activeTab === id ? "active" : ""}" data-tab="${id}">${label}</button>`).join("")}
          </nav>
        </aside>
        <main class="content" id="content"></main>
      </div>
    </div>
  `;
}

async function loadEmployees() {
  if (!isAdmin()) return;
  const data = await api("/api/employees");
  state.employees = data.employees;
  if (!state.selectedEmployeeId) state.selectedEmployeeId = state.employees[0]?.id || state.user.employeeId;
}

function employeePicker() {
  if (!isAdmin()) return "";
  return `
    <label>Employee
      <select data-action="select-employee">
        ${state.employees.map(emp => `<option value="${emp.id}" ${Number(state.selectedEmployeeId) === emp.id ? "selected" : ""}>${escapeHtml(emp.full_name)} (${escapeHtml(emp.employee_code)})</option>`).join("")}
      </select>
    </label>
  `;
}

async function renderTab() {
  renderShell();
  const content = document.getElementById("content");
  const renderers = {
    dashboard: renderDashboard,
    profile: renderProfile,
    attendance: renderAttendance,
    leave: renderLeave,
    payroll: renderPayroll,
    employees: renderEmployees
  };
  content.innerHTML = `<section class="panel">Loading...</section>`;
  content.innerHTML = await renderers[state.activeTab]();
}

async function renderDashboard() {
  const data = await api("/api/dashboard");
  if (isAdmin()) {
    return `
      <div class="page-title">
        <div><h1>Admin Dashboard</h1><div class="muted">Live status from MySQL</div></div>
      </div>
      <section class="grid-3">
        <div class="metric">Employees<strong>${data.metrics.employees}</strong></div>
        <div class="metric">Pending Leave<strong>${data.metrics.pendingLeaves}</strong></div>
        <div class="metric">Present Today<strong>${data.metrics.presentToday}</strong></div>
      </section>
      <section class="panel">
        <h2>Recent Leave Requests</h2>
        ${table(["Employee", "Type", "Dates", "Status"], data.recentLeaves.map(row => [
          row.full_name,
          row.leave_type,
          `${dateOnly(row.start_date)} to ${dateOnly(row.end_date)}`,
          chip(row.status)
        ]))}
      </section>
    `;
  }

  const leaveText = data.metrics.leaveSummary.map(item => `${item.status}: ${item.count}`).join(", ") || "No leave requests";
  const attendanceText = data.metrics.attendanceSummary.map(item => `${item.status}: ${item.count}`).join(", ") || "No attendance yet";
  return `
    <div class="page-title">
      <div><h1>Employee Dashboard</h1><div class="muted">${escapeHtml(state.user.fullName)}</div></div>
    </div>
    <section class="grid-3">
      <div class="metric">Net Salary<strong>${money(data.metrics.netSalary)}</strong></div>
      <div class="metric">Leave<strong style="font-size:18px">${escapeHtml(leaveText)}</strong></div>
      <div class="metric">Attendance<strong style="font-size:18px">${escapeHtml(attendanceText)}</strong></div>
    </section>
  `;
}

async function renderProfile() {
  const employeeId = isAdmin() ? state.selectedEmployeeId : state.user.employeeId;
  const data = await api(`/api/profile?employeeId=${employeeId}`);
  const p = data.profile;
  const readonly = !isAdmin();
  return `
    <div class="page-title">
      <div><h1>Profile</h1><div class="muted">${escapeHtml(p.email)}</div></div>
      ${employeePicker()}
    </div>
    <section class="panel">
      <form class="form-grid" data-form="profile">
        <div class="two">
          <label>Full Name <input name="full_name" value="${escapeHtml(p.full_name)}" ${readonly ? "disabled" : ""}></label>
          <label>Employee ID <input value="${escapeHtml(p.employee_code)}" disabled></label>
        </div>
        <div class="two">
          <label>Department <input name="department" value="${escapeHtml(p.department)}" ${readonly ? "disabled" : ""}></label>
          <label>Designation <input name="designation" value="${escapeHtml(p.designation)}" ${readonly ? "disabled" : ""}></label>
        </div>
        <div class="two">
          <label>Phone <input name="phone" value="${escapeHtml(p.phone)}"></label>
          <label>Joining Date <input name="joining_date" type="date" value="${dateOnly(p.joining_date)}" ${readonly ? "disabled" : ""}></label>
        </div>
        <label>Address <textarea name="address">${escapeHtml(p.address)}</textarea></label>
        <label>Profile Picture URL <input name="profile_picture" value="${escapeHtml(p.profile_picture)}"></label>
        ${isAdmin() ? `<label>Documents <textarea name="documents">${escapeHtml(p.documents || "")}</textarea></label>` : ""}
        <button type="submit">Save Profile</button>
      </form>
    </section>
  `;
}

async function renderAttendance() {
  const employeeId = isAdmin() ? state.selectedEmployeeId : state.user.employeeId;
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const data = await api(`/api/attendance?employeeId=${employeeId}&start=${start}&end=${end}`);
  return `
    <div class="page-title">
      <div><h1>Attendance</h1><div class="muted">Daily and monthly attendance</div></div>
      ${employeePicker()}
    </div>
    <section class="panel">
      <div class="toolbar">
        ${!isAdmin() ? `<button data-action="check-in">Check In</button><button class="secondary" data-action="check-out">Check Out</button>` : ""}
      </div>
      ${calendar(now, data.attendance)}
    </section>
    ${isAdmin() ? adminAttendanceForm(employeeId) : ""}
    <section class="panel">
      <h2>Records</h2>
      ${attendanceTable(data.attendance)}
    </section>
  `;
}

function adminAttendanceForm(employeeId) {
  return `
    <section class="panel">
      <h2>Save Attendance</h2>
      <form class="form-grid" data-form="attendance">
        <input type="hidden" name="employeeId" value="${employeeId}">
        <div class="two">
          <label>Date <input name="workDate" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label>
          <label>Status
            <select name="status">
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="half-day">Half-day</option>
              <option value="leave">Leave</option>
            </select>
          </label>
        </div>
        <div class="two">
          <label>Check In <input name="checkIn" type="datetime-local"></label>
          <label>Check Out <input name="checkOut" type="datetime-local"></label>
        </div>
        <label>Remarks <input name="remarks"></label>
        <button type="submit">Save Attendance</button>
      </form>
    </section>
  `;
}

function calendar(monthDate, records) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const map = Object.fromEntries(records.map(row => [dateOnly(row.work_date), row]));
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(`<div class="day"></div>`);
  for (let day = 1; day <= last.getDate(); day++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const record = map[key];
    cells.push(`<div class="day"><small>${day}</small>${record ? chip(record.status) : ""}</div>`);
  }
  return `
    <div class="calendar">
      ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => `<div class="weekday">${day}</div>`).join("")}
      ${cells.join("")}
    </div>
  `;
}

function attendanceTable(rows) {
  return table(["Date", "In", "Out", "Status", "Remarks"], rows.map(row => [
    dateOnly(row.work_date),
    row.check_in ? String(row.check_in).slice(11, 19) : "-",
    row.check_out ? String(row.check_out).slice(11, 19) : "-",
    chip(row.status),
    row.remarks || "-"
  ]));
}

async function renderLeave() {
  const data = await api("/api/leaves");
  return `
    <div class="page-title">
      <div><h1>Leave</h1><div class="muted">${isAdmin() ? "Approval workflow" : "Requests and status"}</div></div>
    </div>
    ${!isAdmin() ? leaveForm() : ""}
    <section class="panel">
      <h2>${isAdmin() ? "All Requests" : "My Requests"}</h2>
      ${leaveTable(data.leaves)}
    </section>
  `;
}

function leaveForm() {
  return `
    <section class="panel">
      <h2>Apply for Leave</h2>
      <form class="form-grid" data-form="leave">
        <div class="two">
          <label>Type
            <select name="leaveType">
              <option>Paid</option>
              <option>Sick</option>
              <option>Unpaid</option>
            </select>
          </label>
          <label>Start Date <input name="startDate" type="date" required></label>
        </div>
        <label>End Date <input name="endDate" type="date" required></label>
        <label>Remarks <textarea name="remarks"></textarea></label>
        <button type="submit">Submit Request</button>
      </form>
    </section>
  `;
}

function leaveTable(rows) {
  return table(
    isAdmin() ? ["Employee", "Type", "Dates", "Status", "Action"] : ["Type", "Dates", "Status", "Comment"],
    rows.map(row => {
      const common = [
        row.leave_type,
        `${dateOnly(row.start_date)} to ${dateOnly(row.end_date)}`,
        chip(row.status)
      ];
      if (!isAdmin()) return [...common, row.reviewer_comment || "-"];
      return [
        `${escapeHtml(row.full_name)} (${escapeHtml(row.employee_code)})`,
        ...common,
        row.status === "Pending"
          ? `<div class="toolbar"><button data-action="review-leave" data-id="${row.id}" data-status="Approved">Approve</button><button class="danger" data-action="review-leave" data-id="${row.id}" data-status="Rejected">Reject</button></div>`
          : row.reviewer_comment || "-"
      ];
    })
  );
}

async function renderPayroll() {
  const employeeId = isAdmin() ? state.selectedEmployeeId : state.user.employeeId;
  const data = await api(`/api/payroll?employeeId=${employeeId}`);
  const p = data.payroll || {};
  return `
    <div class="page-title">
      <div><h1>Payroll</h1><div class="muted">${escapeHtml(p.full_name || "")}</div></div>
      ${employeePicker()}
    </div>
    <section class="grid-3">
      <div class="metric">Basic<strong>${money(p.basic)}</strong></div>
      <div class="metric">Allowances<strong>${money(Number(p.hra || 0) + Number(p.allowances || 0))}</strong></div>
      <div class="metric">Net Salary<strong>${money(p.net_salary)}</strong></div>
    </section>
    ${isAdmin() ? payrollForm(p, employeeId) : ""}
  `;
}

function payrollForm(p, employeeId) {
  return `
    <section class="panel">
      <h2>Update Salary Structure</h2>
      <form class="form-grid" data-form="payroll">
        <input type="hidden" name="employeeId" value="${employeeId}">
        <div class="two">
          <label>Basic <input name="basic" type="number" value="${Number(p.basic || 0)}"></label>
          <label>HRA <input name="hra" type="number" value="${Number(p.hra || 0)}"></label>
        </div>
        <div class="two">
          <label>Allowances <input name="allowances" type="number" value="${Number(p.allowances || 0)}"></label>
          <label>Deductions <input name="deductions" type="number" value="${Number(p.deductions || 0)}"></label>
        </div>
        <label>Effective From <input name="effectiveFrom" type="date" value="${dateOnly(p.effective_from)}"></label>
        <button type="submit">Save Payroll</button>
      </form>
    </section>
  `;
}

async function renderEmployees() {
  await loadEmployees();
  return `
    <div class="page-title">
      <div><h1>Employees</h1><div class="muted">Admin and HR directory</div></div>
    </div>
    <section class="panel">
      ${table(["Employee", "Email", "Role", "Department", "Designation"], state.employees.map(emp => [
        `<button class="ghost" data-action="open-employee" data-id="${emp.id}">${escapeHtml(emp.full_name)}</button>`,
        emp.email,
        emp.role,
        emp.department,
        emp.designation
      ]))}
    </section>
  `;
}

function table(headers, rows) {
  if (!rows.length) return `<div class="muted">No records yet.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${tableCell(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function tableCell(value) {
  const html = String(value ?? "");
  const trusted = html.includes("<span class=\"status") || html.includes("<button") || html.includes("<div class=\"toolbar");
  return trusted ? html : escapeHtml(html);
}

function chip(value) {
  return `<span class="status ${escapeHtml(value)}">${escapeHtml(value)}</span>`;
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

document.addEventListener("click", async event => {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    state.activeTab = tab.dataset.tab;
    await renderTab();
    return;
  }

  const authTab = event.target.closest("[data-auth-tab]");
  if (authTab) {
    renderAuth(authTab.dataset.authTab);
    return;
  }

  const action = event.target.closest("[data-action]");
  if (!action) return;

  try {
    if (action.dataset.action === "signout") {
      await api("/api/auth/signout", { method: "POST" }).catch(() => {});
      localStorage.removeItem("hrms_token");
      state.token = "";
      renderAuth("signin");
    }

    if (action.dataset.action === "check-in") {
      const data = await api("/api/attendance/check-in", { method: "POST" });
      notify(data.message);
      await renderTab();
    }

    if (action.dataset.action === "check-out") {
      const data = await api("/api/attendance/check-out", { method: "POST" });
      notify(data.message);
      await renderTab();
    }

    if (action.dataset.action === "review-leave") {
      const comment = action.dataset.status === "Approved" ? "Approved by HR" : "Rejected by HR";
      const data = await api(`/api/leaves/${action.dataset.id}/review`, {
        method: "PATCH",
        body: { status: action.dataset.status, comment }
      });
      notify(data.message);
      await renderTab();
    }

    if (action.dataset.action === "open-employee") {
      state.selectedEmployeeId = Number(action.dataset.id);
      state.activeTab = "profile";
      await renderTab();
    }
  } catch (error) {
    notify(error.message);
  }
});

document.addEventListener("change", async event => {
  if (event.target.matches("[data-action='select-employee']")) {
    state.selectedEmployeeId = Number(event.target.value);
    await renderTab();
  }
});

document.addEventListener("submit", async event => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const body = formData(form);

  try {
    if (form.dataset.form === "signin") {
      const data = await api("/api/auth/signin", { method: "POST", body });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem("hrms_token", state.token);
      notify("Signed in.");
      await boot();
    }

    if (form.dataset.form === "signup") {
      const data = await api("/api/auth/signup", { method: "POST", body });
      notify(data.message);
      renderAuth("signin");
    }

    if (form.dataset.form === "profile") {
      const employeeId = isAdmin() ? state.selectedEmployeeId : state.user.employeeId;
      const data = await api(`/api/profile?employeeId=${employeeId}`, { method: "PATCH", body });
      notify(data.message);
      await loadEmployees();
      await renderTab();
    }

    if (form.dataset.form === "attendance") {
      const data = await api("/api/attendance", { method: "POST", body });
      notify(data.message);
      await renderTab();
    }

    if (form.dataset.form === "leave") {
      const data = await api("/api/leaves", { method: "POST", body });
      notify(data.message);
      await renderTab();
    }

    if (form.dataset.form === "payroll") {
      const employeeId = body.employeeId;
      delete body.employeeId;
      const data = await api(`/api/payroll/${employeeId}`, { method: "PATCH", body });
      notify(data.message);
      await renderTab();
    }
  } catch (error) {
    notify(error.message);
  }
});

boot();
