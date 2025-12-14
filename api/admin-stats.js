// /api/admin-stats.js
import { getDb } from "./_firebaseAdmin.js";

export default async function handler(req, res) {
  try {
    const adminToken = req.headers["x-admin-token"];
    if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const db = getDb();
    const logsRef = db.collection("logs"); // ⚠️ usa lo stesso nome di admin-logs.js

    const {
      from,   // YYYY-MM-DD
      to,     // YYYY-MM-DD
      tz = "UTC"
    } = req.query;

    if (!from || !to) {
      return res.status(400).json({ ok: false, error: "Missing from/to" });
    }

    const start = new Date(from + "T00:00:00Z").getTime();
    const end   = new Date(to   + "T23:59:59Z").getTime();

    async function count(where = []) {
      let q = logsRef.where("ts", ">=", start).where("ts", "<=", end);
      for (const [field, op, value] of where) {
        q = q.where(field, op, value);
      }
      const snap = await q.count().get();
      return snap.data().count || 0;
    }

    const stats = {
      range: { from, to },
      total: await count(),

      style: {
        whatif: await count([["style", "==", "whatif"]]),
        wtf:    await count([["style", "==", "wtf"]])
      },

      periodo: {
        future: await count([["periodo", "==", "future"]]),
        past:   await count([["periodo", "==", "past"]])
      },

      matrix: {
        whatif: {
          future: await count([["style","==","whatif"],["periodo","==","future"]]),
          past:   await count([["style","==","whatif"],["periodo","==","past"]])
        },
        wtf: {
          future: await count([["style","==","wtf"],["periodo","==","future"]]),
          past:   await count([["style","==","wtf"],["periodo","==","past"]])
        }
      },

      source: {
        manual:    await count([["source","==","manual"]]),
        hint:      await count([["source","==","hint"]]),
        surprise:  await count([["source","==","surprise"]])
      }
    };

    res.json({ ok: true, stats });
  } catch (e) {
    console.error("admin-stats error", e);
    res.status(500).json({ ok:false, error:"Server error" });
  }
}
