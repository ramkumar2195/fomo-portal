#!/usr/bin/env node

/**
 * FOMO Seed Data Script
 *
 * Seeds the backend with test data for development.
 * Requires the API gateway to be running at localhost:8081.
 *
 * Usage:
 *   node scripts/seed-data.mjs
 *   node scripts/seed-data.mjs --admin-only   # only seed admin user
 *   node scripts/seed-data.mjs --reset        # clear and re-seed
 */

const API_BASE = process.env.API_BASE_URL || "http://localhost:8081";

const ADMIN_CREDS = { mobile: "9999900000", password: "Admin@123" };
const STAFF_CREDS = { mobile: "9999900001", password: "Staff@123" };

const MEMBERS = [
  { name: "Amit Verma", mobile: "9888800001", email: "amit@test.com", password: "Member@123" },
  { name: "Priya Sharma", mobile: "9888800002", email: "priya@test.com", password: "Member@123" },
  { name: "Raj Patel", mobile: "9888800003", email: "raj@test.com", password: "Member@123" },
  { name: "Sonia Khan", mobile: "9888800004", email: "sonia@test.com", password: "Member@123" },
  { name: "Vikram Singh", mobile: "9888800005", email: "vikram@test.com", password: "Member@123" },
];

const BRANCHES = [
  { name: "FOMO Fitness - Koramangala", city: "Bangalore", address: "100 Feet Road, Koramangala", active: true },
  { name: "FOMO Fitness - Indiranagar", city: "Bangalore", address: "12th Main, Indiranagar", active: true },
];

const EQUIPMENT = [
  { name: "Treadmill Pro 5000", category: "CARDIO", brand: "Life Fitness", serialNumber: "TM-001", status: "ACTIVE" },
  { name: "Smith Machine", category: "STRENGTH", brand: "Hammer Strength", serialNumber: "SM-001", status: "ACTIVE" },
  { name: "Cable Crossover", category: "STRENGTH", brand: "Technogym", serialNumber: "CC-001", status: "ACTIVE" },
  { name: "Spin Bike", category: "CARDIO", brand: "Keiser", serialNumber: "SB-001", status: "ACTIVE" },
  { name: "Lat Pulldown", category: "STRENGTH", brand: "Cybex", serialNumber: "LP-001", status: "ACTIVE" },
];

let adminToken = null;

async function api(path, options = {}) {
  const { method = "GET", body, token } = options;
  const url = `${API_BASE}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const fetchOptions = { method, headers };
  if (body) fetchOptions.body = JSON.stringify(body);

  const response = await fetch(url, fetchOptions);
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    const msg = typeof data === "object" ? data.message || JSON.stringify(data) : text;
    throw new Error(`${method} ${path} failed (${response.status}): ${msg}`);
  }

  return data?.data ?? data;
}

async function login(mobile, password) {
  const result = await api("/api/users/login", {
    method: "POST",
    body: { mobile, password },
  });
  return result.accessToken || result.token;
}

async function seedAdmin() {
  console.log("\n--- Seeding Admin ---");
  try {
    adminToken = await login(ADMIN_CREDS.mobile, ADMIN_CREDS.password);
    console.log("  Admin login successful");
  } catch {
    console.log("  Admin login failed - admin user may need manual creation via Keycloak");
    console.log("  Attempting to continue with staff login...");
    try {
      adminToken = await login(STAFF_CREDS.mobile, STAFF_CREDS.password);
      console.log("  Staff login successful (using as admin)");
    } catch {
      console.log("  No admin/staff credentials work. Seed data requires at least one admin user.");
      console.log("  Create via Keycloak admin console: mobile=9999900000, password=Admin@123, role=ADMIN");
      process.exit(1);
    }
  }
}

async function seedBranches() {
  console.log("\n--- Seeding Branches ---");
  for (const branch of BRANCHES) {
    try {
      const result = await api("/api/branches", {
        method: "POST",
        body: branch,
        token: adminToken,
      });
      console.log(`  Created branch: ${branch.name} (id: ${result?.id || "?"})`);
    } catch (err) {
      console.log(`  Branch "${branch.name}" may already exist: ${err.message.slice(0, 80)}`);
    }
  }
}

async function seedMembers() {
  console.log("\n--- Seeding Members ---");
  for (const member of MEMBERS) {
    try {
      const result = await api("/api/users", {
        method: "POST",
        body: {
          name: member.name,
          mobile: member.mobile,
          email: member.email,
          password: member.password,
          role: "MEMBER",
          active: true,
        },
        token: adminToken,
      });
      console.log(`  Created member: ${member.name} (id: ${result?.id || "?"})`);
    } catch (err) {
      console.log(`  Member "${member.name}" may already exist: ${err.message.slice(0, 80)}`);
    }
  }
}

async function seedEquipment() {
  console.log("\n--- Seeding Equipment ---");
  for (const eq of EQUIPMENT) {
    try {
      const result = await api("/api/facilities/equipment", {
        method: "POST",
        body: eq,
        token: adminToken,
      });
      console.log(`  Created equipment: ${eq.name} (id: ${result?.id || "?"})`);
    } catch (err) {
      console.log(`  Equipment "${eq.name}" may already exist: ${err.message.slice(0, 80)}`);
    }
  }
}

async function seedCreditRules() {
  console.log("\n--- Seeding Credit Rules ---");
  try {
    await api("/api/credits/rules/bootstrap-defaults", {
      method: "POST",
      body: {},
      token: adminToken,
    });
    console.log("  Credit rules bootstrapped successfully");
  } catch (err) {
    console.log(`  Credit rules bootstrap: ${err.message.slice(0, 80)}`);
  }
}

async function seedCommunityPosts() {
  console.log("\n--- Seeding Community Posts ---");
  const posts = [
    { content: "Welcome to the FOMO Gym Community! Share your fitness journey here.", title: "Welcome Post" },
    { content: "New batch of Zumba classes starting next Monday at 7 PM. Limited slots!", title: "Zumba Alert" },
    { content: "Remember: Consistency beats intensity. Show up every day!", title: "Motivation Monday" },
  ];

  for (const post of posts) {
    try {
      // Use a member token for community posts
      const memberToken = await login(MEMBERS[0].mobile, MEMBERS[0].password);
      await api("/api/community/posts", {
        method: "POST",
        body: { ...post, authorId: 1 },
        token: memberToken,
      });
      console.log(`  Created post: "${post.title}"`);
    } catch (err) {
      console.log(`  Post "${post.title}": ${err.message.slice(0, 80)}`);
    }
  }
}

async function seedInquiries() {
  console.log("\n--- Seeding Inquiries ---");
  const inquiries = [
    { name: "Lead One", mobile: "9777700001", source: "WALK_IN", notes: "Interested in annual membership" },
    { name: "Lead Two", mobile: "9777700002", source: "REFERRAL", notes: "Referred by Amit" },
    { name: "Lead Three", mobile: "9777700003", source: "WEBSITE", notes: "Submitted online form" },
  ];

  for (const inq of inquiries) {
    try {
      await api("/api/subscriptions/v2/inquiries", {
        method: "POST",
        body: inq,
        token: adminToken,
      });
      console.log(`  Created inquiry: ${inq.name}`);
    } catch (err) {
      console.log(`  Inquiry "${inq.name}": ${err.message.slice(0, 80)}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const adminOnly = args.includes("--admin-only");

  console.log(`FOMO Seed Data Script`);
  console.log(`API Base: ${API_BASE}`);
  console.log(`Mode: ${adminOnly ? "Admin only" : "Full seed"}`);

  await seedAdmin();

  if (adminOnly) {
    console.log("\n--- Done (admin-only mode) ---\n");
    return;
  }

  await seedBranches();
  await seedMembers();
  await seedEquipment();
  await seedCreditRules();
  await seedCommunityPosts();
  await seedInquiries();

  console.log("\n--- Seed Complete ---");
  console.log("Admin: mobile=9999900000 password=Admin@123");
  console.log("Staff: mobile=9999900001 password=Staff@123");
  console.log("Members: mobile=9888800001-05 password=Member@123\n");
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
