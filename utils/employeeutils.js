// utils/employeeUtils.js
import pool from "../db.js";
import { NodeCache } from '@cacheable/node-cache';

const employeeCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

export const getAllEmployeeNames = async (client) => {
    const cached = employeeCache.get('employeeNames');
    if (cached) return cached;
    const res = await client.query('SELECT name FROM employees');
    const names = new Set(res.rows.map(r => r.name));
    employeeCache.set('employeeNames', names);
    return names;
};

export const checkEmployeeExists = async (name) => {
    const cacheKey = `exists:${name.toLowerCase()}`;
    const cached = employeeCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const client = await pool.connect();
    try {
        const names = await getAllEmployeeNames(client);
        const exists = names.some(n => n.toLowerCase() === name.toLowerCase());
        employeeCache.set(cacheKey, exists);
        return exists;
    } catch (err) {
        console.error("Error checking employee existence:", err);
        return false;
    }
    finally {
        client.release();
    }
};

