const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mysql = require("mysql2/promise");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");

loadEnv(path.join(ROOT, ".env"));

const config = {
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "hrms_live",
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true
  },
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12)
};

let pool;

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...value] = trimmed.split("=");
    if (!process.env[key]) process.env[key] = value.join("=");
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 150000, 64, "sha512").toString("hex");
  return { salt, hash };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function ok(res, data = {}, status = 200) {
  sendJson(res, status, data);
}

function fail(res, status, message, details = null) {
  sendJson(res, status, { error: message, details });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function requireFields(body, fields) {
  const missing = fields.filter(field => !String(body[field] ?? "").trim());
  if (missing.length) throw new PublicError(400, `Missing fields: ${missing.join(", ")}`);
}

function assertPassword(password) {
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password || "")) {
    throw new PublicError(400, "Password must be at least 8 characters and include uppercase, lowercase, and a number.");
  }
}

function assertAdmin(user) {
  if (!["admin", "hr"].includes(user.role)) {
    throw new PublicError(403, "Admin or HR access required.");
  }
}

class PublicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function auth(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new PublicError(401, "Sign in required.");

  const tokenHash = hashToken(match[1]);
  const [rows] = await pool.execute(
    `SELECT u.id, u.employee_code, u.email, u.role, u.is_verified,
            e.id AS employee_id, e.full_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN employees e ON e.user_id = u.id
      WHERE s.token_hash = :tokenHash AND s.expires_at > NOW()`,
    { tokenHash }
  );
  if (!rows.length) throw new PublicError(401, "Session expired. Please sign in again.");
  return rows[0];
}

async function initDatabase() {
  const bootstrap = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true
  });

  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrap.end();

  pool = mysql.createPool(config.db);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_code VARCHAR(30) NOT NULL UNIQUE,
      email VARCHAR(160) NOT NULL UNIQUE,
      password_salt VARCHAR(64) NOT NULL,
      password_hash VARCHAR(128) NOT NULL,
      role ENUM('employee', 'hr', 'admin') NOT NULL DEFAULT 'employee',
      is_verified BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      full_name VARCHAR(160) NOT NULL,
      phone VARCHAR(40) DEFAULT '',
      address VARCHAR(255) DEFAULT '',
      department VARCHAR(120) NOT NULL DEFAULT 'People Operations',
      designation VARCHAR(120) NOT NULL DEFAULT 'Employee',
      joining_date DATE NOT NULL DEFAULT (CURRENT_DATE),
      profile_picture VARCHAR(500) DEFAULT '',
      documents TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash VARCHAR(128) PRIMARY KEY,
      user_id INT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id INT NOT NULL,
      work_date DATE NOT NULL,
      check_in DATETIME NULL,
      check_out DATETIME NULL,
      status ENUM('present', 'absent', 'half-day', 'leave') NOT NULL DEFAULT 'present',
      remarks VARCHAR(255) DEFAULT '',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_employee_day (employee_id, work_date),
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id INT NOT NULL,
      leave_type ENUM('Paid', 'Sick', 'Unpaid') NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      remarks VARCHAR(255) DEFAULT '',
      status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
      reviewer_comment VARCHAR(255) DEFAULT '',
      reviewed_by INT NULL,
      reviewed_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payroll (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id INT NOT NULL UNIQUE,
      basic DECIMAL(12,2) NOT NULL DEFAULT 35000,
      hra DECIMAL(12,2) NOT NULL DEFAULT 12000,
      allowances DECIMAL(12,2) NOT NULL DEFAULT 5000,
      deductions DECIMAL(12,2) NOT NULL DEFAULT 2000,
      effective_from DATE NOT NULL DEFAULT (CURRENT_DATE),
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    )
  `);

  await seedDatabase();
}

async function seedDatabase() {
  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM users");
  if (rows[0].count > 0) return;

  await createUser({
    employeeCode: "HR-001",
    email: "admin@hrms.local",
    password: "Admin@12345",
    role: "admin",
    fullName: "Rishi HR Admin",
    phone: "9000000001",
    address: "Head Office",
    department: "Human Resources",
    designation: "HR Manager",
    payroll: { basic: 75000, hra: 25000, allowances: 10000, deductions: 5000 }
  });

  const employee = await createUser({
    employeeCode: "EMP-001",
    email: "employee@hrms.local",
    password: "Employee@12345",
    role: "employee",
    fullName: "Aarav Sharma",
    phone: "9000000002",
    address: "Bengaluru",
    department: "Engineering",
    designation: "Software Engineer",
    payroll: { basic: 45000, hra: 15000, allowances: 6000, deductions: 2500 }
  });

  await pool.execute(
    `INSERT INTO attendance (employee_id, work_date, check_in, check_out, status, remarks)
     VALUES
       (:employeeId, CURRENT_DATE - INTERVAL 2 DAY, CURRENT_DATE - INTERVAL 2 DAY + INTERVAL 9 HOUR, CURRENT_DATE - INTERVAL 2 DAY + INTERVAL 18 HOUR, 'present', 'Seeded attendance'),
       (:employeeId, CURRENT_DATE - INTERVAL 1 DAY, NULL, NULL, 'absent', 'Seeded absence')`,
    { employeeId: employee.employeeId }
  );
}

async function createUser(input) {
  const { salt, hash } = hashPassword(input.password);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [userResult] = await conn.execute(
      `INSERT INTO users (employee_code, email, password_salt, password_hash, role, is_verified)
       VALUES (:employeeCode, :email, :salt, :hash, :role, TRUE)`,
      {
        employeeCode: input.employeeCode,
        email: input.email.toLowerCase(),
        salt,
        hash,
        role: input.role || "employee"
      }
    );

    const [employeeResult] = await conn.execute(
      `INSERT INTO employees (user_id, full_name, phone, address, department, designation, joining_date, profile_picture, documents)
       VALUES (:userId, :fullName, :phone, :address, :department, :designation, COALESCE(:joiningDate, CURRENT_DATE), :profilePicture, :documents)`,
      {
        userId: userResult.insertId,
        fullName: input.fullName,
        phone: input.phone || "",
        address: input.address || "",
        department: input.department || "People Operations",
        designation: input.designation || "Employee",
        joiningDate: input.joiningDate || null,
        profilePicture: input.profilePicture || "",
        documents: input.documents || ""
      }
    );

    const payroll = input.payroll || {};
    await conn.execute(
      `INSERT INTO payroll (employee_id, basic, hra, allowances, deductions)
       VALUES (:employeeId, :basic, :hra, :allowances, :deductions)`,
      {
        employeeId: employeeResult.insertId,
        basic: Number(payroll.basic ?? 35000),
        hra: Number(payroll.hra ?? 12000),
        allowances: Number(payroll.allowances ?? 5000),
        deductions: Number(payroll.deductions ?? 2000)
      }
    );

    await conn.commit();
    return { userId: userResult.insertId, employeeId: employeeResult.insertId };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function routeApi(req, res, url) {
  const method = req.method;
  const pathName = url.pathname;

  if (method === "POST" && pathName === "/api/auth/signup") {
    const body = await readJson(req);
    requireFields(body, ["employeeCode", "fullName", "email", "password", "role"]);
    assertPassword(body.password);

    if (!["employee", "hr"].includes(body.role)) {
      throw new PublicError(400, "Role must be employee or hr.");
    }

    await createUser({
      employeeCode: body.employeeCode.trim(),
      fullName: body.fullName.trim(),
      email: body.email.trim(),
      password: body.password,
      role: body.role,
      phone: body.phone,
      address: body.address,
      department: body.department,
      designation: body.designation
    });

    return ok(res, { message: "Account created. You can sign in now." }, 201);
  }

  if (method === "POST" && pathName === "/api/auth/signin") {
    const body = await readJson(req);
    requireFields(body, ["email", "password"]);
    const [rows] = await pool.execute(
      `SELECT u.*, e.id AS employee_id, e.full_name
         FROM users u
         JOIN employees e ON e.user_id = u.id
        WHERE u.email = :email`,
      { email: body.email.toLowerCase().trim() }
    );
    if (!rows.length) throw new PublicError(401, "Incorrect email or password.");

    const candidate = hashPassword(body.password, rows[0].password_salt);
    if (!crypto.timingSafeEqual(Buffer.from(candidate.hash), Buffer.from(rows[0].password_hash))) {
      throw new PublicError(401, "Incorrect email or password.");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    await pool.execute(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES (:tokenHash, :userId, DATE_ADD(NOW(), INTERVAL :ttl HOUR))`,
      { tokenHash, userId: rows[0].id, ttl: config.sessionTtlHours }
    );

    return ok(res, {
      token,
      user: publicUser(rows[0])
    });
  }

  if (method === "POST" && pathName === "/api/auth/signout") {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) {
      await pool.execute("DELETE FROM sessions WHERE token_hash = :tokenHash", { tokenHash: hashToken(match[1]) });
    }
    return ok(res, { message: "Signed out." });
  }

  const user = await auth(req);

  if (method === "GET" && pathName === "/api/me") {
    const profile = await getProfile(user.employee_id);
    return ok(res, { user: publicUser(user), profile });
  }

  if (method === "GET" && pathName === "/api/dashboard") {
    return ok(res, await getDashboard(user));
  }

  if (method === "GET" && pathName === "/api/profile") {
    const employeeId = getVisibleEmployeeId(url, user);
    return ok(res, { profile: await getProfile(employeeId) });
  }

  if (method === "PATCH" && pathName === "/api/profile") {
    const body = await readJson(req);
    const employeeId = getVisibleEmployeeId(url, user);
    const adminEdit = employeeId !== user.employee_id || ["admin", "hr"].includes(user.role);
    if (employeeId !== user.employee_id) assertAdmin(user);
    await updateProfile(employeeId, body, adminEdit);
    return ok(res, { message: "Profile updated.", profile: await getProfile(employeeId) });
  }

  if (method === "GET" && pathName === "/api/employees") {
    assertAdmin(user);
    const [employees] = await pool.query(
      `SELECT e.*, u.employee_code, u.email, u.role
         FROM employees e
         JOIN users u ON u.id = e.user_id
        ORDER BY e.full_name`
    );
    return ok(res, { employees });
  }

  if (method === "GET" && pathName === "/api/attendance") {
    const employeeId = getVisibleEmployeeId(url, user);
    const [rows] = await pool.execute(
      `SELECT a.*, e.full_name, u.employee_code
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
         JOIN users u ON u.id = e.user_id
        WHERE a.employee_id = :employeeId
          AND a.work_date BETWEEN COALESCE(:startDate, DATE_FORMAT(CURRENT_DATE, '%Y-%m-01'))
                              AND COALESCE(:endDate, LAST_DAY(CURRENT_DATE))
        ORDER BY a.work_date DESC`,
      {
        employeeId,
        startDate: url.searchParams.get("start") || null,
        endDate: url.searchParams.get("end") || null
      }
    );
    return ok(res, { attendance: rows });
  }

  if (method === "POST" && pathName === "/api/attendance/check-in") {
    await pool.execute(
      `INSERT INTO attendance (employee_id, work_date, check_in, status, remarks)
       VALUES (:employeeId, CURRENT_DATE, NOW(), 'present', 'Checked in')
       ON DUPLICATE KEY UPDATE check_in = COALESCE(check_in, NOW()), status = 'present', remarks = 'Checked in'`,
      { employeeId: user.employee_id }
    );
    return ok(res, { message: "Checked in.", attendance: await todaysAttendance(user.employee_id) });
  }

  if (method === "POST" && pathName === "/api/attendance/check-out") {
    await pool.execute(
      `INSERT INTO attendance (employee_id, work_date, check_in, check_out, status, remarks)
       VALUES (:employeeId, CURRENT_DATE, NOW(), NOW(), 'present', 'Checked out')
       ON DUPLICATE KEY UPDATE check_out = NOW(), remarks = 'Checked out'`,
      { employeeId: user.employee_id }
    );
    return ok(res, { message: "Checked out.", attendance: await todaysAttendance(user.employee_id) });
  }

  if (method === "POST" && pathName === "/api/attendance") {
    assertAdmin(user);
    const body = await readJson(req);
    requireFields(body, ["employeeId", "workDate", "status"]);
    await pool.execute(
      `INSERT INTO attendance (employee_id, work_date, check_in, check_out, status, remarks)
       VALUES (:employeeId, :workDate, :checkIn, :checkOut, :status, :remarks)
       ON DUPLICATE KEY UPDATE check_in = VALUES(check_in), check_out = VALUES(check_out),
         status = VALUES(status), remarks = VALUES(remarks)`,
      {
        employeeId: Number(body.employeeId),
        workDate: body.workDate,
        checkIn: body.checkIn || null,
        checkOut: body.checkOut || null,
        status: body.status,
        remarks: body.remarks || ""
      }
    );
    return ok(res, { message: "Attendance saved." });
  }

  if (method === "GET" && pathName === "/api/leaves") {
    const admin = ["admin", "hr"].includes(user.role);
    const [rows] = await pool.execute(
      `SELECT lr.*, e.full_name, u.employee_code
         FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id
         JOIN users u ON u.id = e.user_id
        WHERE (:admin = TRUE OR lr.employee_id = :employeeId)
        ORDER BY lr.created_at DESC`,
      { admin, employeeId: user.employee_id }
    );
    return ok(res, { leaves: rows });
  }

  if (method === "POST" && pathName === "/api/leaves") {
    const body = await readJson(req);
    requireFields(body, ["leaveType", "startDate", "endDate"]);
    if (!["Paid", "Sick", "Unpaid"].includes(body.leaveType)) {
      throw new PublicError(400, "Invalid leave type.");
    }
    if (body.endDate < body.startDate) throw new PublicError(400, "End date must be after start date.");

    await pool.execute(
      `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, remarks)
       VALUES (:employeeId, :leaveType, :startDate, :endDate, :remarks)`,
      {
        employeeId: user.employee_id,
        leaveType: body.leaveType,
        startDate: body.startDate,
        endDate: body.endDate,
        remarks: body.remarks || ""
      }
    );
    return ok(res, { message: "Leave request submitted." }, 201);
  }

  const reviewMatch = pathName.match(/^\/api\/leaves\/(\d+)\/review$/);
  if (method === "PATCH" && reviewMatch) {
    assertAdmin(user);
    const body = await readJson(req);
    if (!["Approved", "Rejected"].includes(body.status)) throw new PublicError(400, "Status must be Approved or Rejected.");
    const leaveId = Number(reviewMatch[1]);
    const [leaves] = await pool.execute("SELECT * FROM leave_requests WHERE id = :id", { id: leaveId });
    if (!leaves.length) throw new PublicError(404, "Leave request not found.");

    await pool.execute(
      `UPDATE leave_requests
          SET status = :status, reviewer_comment = :comment, reviewed_by = :reviewedBy, reviewed_at = NOW()
        WHERE id = :id`,
      {
        id: leaveId,
        status: body.status,
        comment: body.comment || "",
        reviewedBy: user.id
      }
    );

    if (body.status === "Approved") {
      await markLeaveAttendance(leaves[0]);
    }

    return ok(res, { message: `Leave ${body.status.toLowerCase()}.` });
  }

  if (method === "GET" && pathName === "/api/payroll") {
    const employeeId = getVisibleEmployeeId(url, user);
    const [rows] = await pool.execute(
      `SELECT p.*, e.full_name, u.employee_code,
              (p.basic + p.hra + p.allowances - p.deductions) AS net_salary
         FROM payroll p
         JOIN employees e ON e.id = p.employee_id
         JOIN users u ON u.id = e.user_id
        WHERE p.employee_id = :employeeId`,
      { employeeId }
    );
    return ok(res, { payroll: rows[0] || null });
  }

  const payrollMatch = pathName.match(/^\/api\/payroll\/(\d+)$/);
  if (method === "PATCH" && payrollMatch) {
    assertAdmin(user);
    const body = await readJson(req);
    await pool.execute(
      `UPDATE payroll
          SET basic = :basic, hra = :hra, allowances = :allowances, deductions = :deductions,
              effective_from = COALESCE(:effectiveFrom, effective_from)
        WHERE employee_id = :employeeId`,
      {
        employeeId: Number(payrollMatch[1]),
        basic: Number(body.basic || 0),
        hra: Number(body.hra || 0),
        allowances: Number(body.allowances || 0),
        deductions: Number(body.deductions || 0),
        effectiveFrom: body.effectiveFrom || null
      }
    );
    return ok(res, { message: "Payroll updated." });
  }

  throw new PublicError(404, "API route not found.");
}

function publicUser(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeCode: row.employee_code,
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    isVerified: Boolean(row.is_verified)
  };
}

function getVisibleEmployeeId(url, user) {
  const requested = Number(url.searchParams.get("employeeId") || user.employee_id);
  if (requested !== user.employee_id) assertAdmin(user);
  return requested;
}

async function getProfile(employeeId) {
  const [rows] = await pool.execute(
    `SELECT e.*, u.employee_code, u.email, u.role
       FROM employees e
       JOIN users u ON u.id = e.user_id
      WHERE e.id = :employeeId`,
    { employeeId }
  );
  if (!rows.length) throw new PublicError(404, "Employee not found.");
  return rows[0];
}

async function updateProfile(employeeId, body, adminEdit) {
  const allowed = adminEdit
    ? ["full_name", "phone", "address", "department", "designation", "joining_date", "profile_picture", "documents"]
    : ["phone", "address", "profile_picture"];

  const fields = [];
  const params = { employeeId };
  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      fields.push(`${field} = :${field}`);
      params[field] = body[field] || "";
    }
  }
  if (!fields.length) throw new PublicError(400, "No editable profile fields supplied.");
  await pool.execute(`UPDATE employees SET ${fields.join(", ")} WHERE id = :employeeId`, params);
}

async function getDashboard(user) {
  if (["admin", "hr"].includes(user.role)) {
    const [[employeeCount], [pendingLeaves], [todayPresent]] = await Promise.all([
      pool.query("SELECT COUNT(*) AS count FROM employees"),
      pool.query("SELECT COUNT(*) AS count FROM leave_requests WHERE status = 'Pending'"),
      pool.query("SELECT COUNT(*) AS count FROM attendance WHERE work_date = CURRENT_DATE AND status = 'present'")
    ]);
    const [recentLeaves] = await pool.query(
      `SELECT lr.id, lr.status, lr.leave_type, lr.start_date, lr.end_date, e.full_name
         FROM leave_requests lr
         JOIN employees e ON e.id = lr.employee_id
        ORDER BY lr.created_at DESC
        LIMIT 6`
    );
    return {
      metrics: {
        employees: employeeCount[0].count,
        pendingLeaves: pendingLeaves[0].count,
        presentToday: todayPresent[0].count
      },
      recentLeaves
    };
  }

  const [[leaveSummary], [attendanceSummary], [payrollRows]] = await Promise.all([
    pool.execute(
      `SELECT status, COUNT(*) AS count
         FROM leave_requests
        WHERE employee_id = :employeeId
        GROUP BY status`,
      { employeeId: user.employee_id }
    ),
    pool.execute(
      `SELECT status, COUNT(*) AS count
         FROM attendance
        WHERE employee_id = :employeeId AND work_date >= CURRENT_DATE - INTERVAL 30 DAY
        GROUP BY status`,
      { employeeId: user.employee_id }
    ),
    pool.execute(
      `SELECT basic + hra + allowances - deductions AS net_salary
         FROM payroll
        WHERE employee_id = :employeeId`,
      { employeeId: user.employee_id }
    )
  ]);

  return {
    metrics: {
      leaveSummary,
      attendanceSummary,
      netSalary: payrollRows[0]?.net_salary || 0
    }
  };
}

async function todaysAttendance(employeeId) {
  const [rows] = await pool.execute(
    "SELECT * FROM attendance WHERE employee_id = :employeeId AND work_date = CURRENT_DATE",
    { employeeId }
  );
  return rows[0] || null;
}

async function markLeaveAttendance(leave) {
  const dates = [];
  const current = new Date(`${toDateOnly(leave.start_date)}T00:00:00`);
  const end = new Date(`${toDateOnly(leave.end_date)}T00:00:00`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }

  for (const workDate of dates) {
    await pool.execute(
      `INSERT INTO attendance (employee_id, work_date, status, remarks)
       VALUES (:employeeId, :workDate, 'leave', 'Approved leave')
       ON DUPLICATE KEY UPDATE status = 'leave', remarks = 'Approved leave'`,
      { employeeId: leave.employee_id, workDate }
    );
  }
}

function toDateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallbackData) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
        } else {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(fallbackData);
        }
      });
      return;
    }

    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (error) {
    if (error instanceof PublicError) return fail(res, error.status, error.message);
    if (error.code === "ER_DUP_ENTRY") return fail(res, 409, "Employee code or email already exists.");
    console.error(error);
    fail(res, 500, "Server error. Check terminal logs for details.");
  }
}

initDatabase()
  .then(() => {
    http.createServer(handle).listen(config.port, () => {
      console.log(`HRMS running at http://localhost:${config.port}`);
      console.log(`MySQL database: ${config.db.database}`);
    });
  })
  .catch(error => {
    console.error("Failed to start HRMS:", error.message);
    process.exit(1);
  });
