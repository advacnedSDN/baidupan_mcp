import fs from "node:fs";
import path from "node:path";
import { getValidAccessToken } from "./auth.js";

const API_BASE = "https://pan.baidu.com/rest/2.0/xpan/file";
const UPLOAD_BASE = "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2";
const SHARE_URL = "https://pan.baidu.com/share/set";
const SLICE_SIZE = 4 * 1024 * 1024; // 4MB, standard slice size for xpan uploads

async function apiGet(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.errno && data.errno !== 0) {
    throw new Error(`Baidu API error ${data.errno}: ${data.errmsg || JSON.stringify(data)}`);
  }
  return data;
}

async function apiPost(url, body, opts = {}) {
  const res = await fetch(url, { method: "POST", body, ...opts });
  const data = await res.json();
  if (data.errno && data.errno !== 0) {
    throw new Error(`Baidu API error ${data.errno}: ${data.errmsg || JSON.stringify(data)}`);
  }
  return data;
}

export async function listDir(dir = "/") {
  const token = await getValidAccessToken();
  const url = new URL(API_BASE);
  url.searchParams.set("method", "list");
  url.searchParams.set("access_token", token);
  url.searchParams.set("dir", dir);
  const data = await apiGet(url);
  return data.list.map((f) => ({
    name: f.server_filename,
    path: f.path,
    is_dir: f.isdir === 1,
    size: f.size,
    modified: new Date(f.server_mtime * 1000).toISOString(),
    fs_id: f.fs_id,
  }));
}

export async function searchFiles(keyword, dir = "/") {
  const token = await getValidAccessToken();
  const url = new URL(API_BASE);
  url.searchParams.set("method", "search");
  url.searchParams.set("access_token", token);
  url.searchParams.set("key", keyword);
  url.searchParams.set("dir", dir);
  url.searchParams.set("recursion", "1");
  const data = await apiGet(url);
  return (data.list || []).map((f) => ({
    name: f.server_filename,
    path: f.path,
    is_dir: f.isdir === 1,
    size: f.size,
    fs_id: f.fs_id,
  }));
}

async function getDownloadLink(remotePath) {
  const token = await getValidAccessToken();
  const meta = new URL(
    "https://pan.baidu.com/rest/2.0/xpan/multimedia"
  );
  meta.searchParams.set("method", "filemetas");
  meta.searchParams.set("access_token", token);
  meta.searchParams.set("dlink", "1");
  // filemetas addresses files by fs_id, so resolve the path via search/list first.
  const found = (await searchFiles(path.basename(remotePath), path.dirname(remotePath))).find(
    (f) => f.path === remotePath
  );
  if (!found) throw new Error(`File not found on Baidu Netdisk: ${remotePath}`);
  meta.searchParams.set("fsids", `[${found.fs_id}]`);
  const data = await apiGet(meta);
  const info = data.list?.[0];
  if (!info?.dlink) throw new Error(`No download link returned for ${remotePath}`);
  return { dlink: info.dlink, token };
}

export async function downloadFile(remotePath, localPath) {
  const { dlink, token } = await getDownloadLink(remotePath);
  const url = new URL(dlink);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, {
    headers: { "User-Agent": "pan.baidu.com" }, // required by Baidu's CDN
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(localPath, buf);
  return { localPath, bytes: buf.length };
}

export async function uploadFile(localPath, remotePath) {
  const token = await getValidAccessToken();
  const data = fs.readFileSync(localPath);
  const size = data.length;
  const blockCount = Math.max(1, Math.ceil(size / SLICE_SIZE));
  const blockList = [];
  const crypto = await import("node:crypto");
  for (let i = 0; i < blockCount; i++) {
    const chunk = data.subarray(i * SLICE_SIZE, (i + 1) * SLICE_SIZE);
    blockList.push(crypto.createHash("md5").update(chunk).digest("hex"));
  }

  const precreateUrl = new URL(API_BASE);
  precreateUrl.searchParams.set("method", "precreate");
  precreateUrl.searchParams.set("access_token", token);
  const precreateBody = new URLSearchParams({
    path: remotePath,
    size: String(size),
    isdir: "0",
    autoinit: "1",
    block_list: JSON.stringify(blockList),
    rtype: "3", // overwrite if exists
  });
  const pre = await apiPost(precreateUrl, precreateBody, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  for (let i = 0; i < blockCount; i++) {
    const chunk = data.subarray(i * SLICE_SIZE, (i + 1) * SLICE_SIZE);
    const upUrl = new URL(UPLOAD_BASE);
    upUrl.searchParams.set("method", "upload");
    upUrl.searchParams.set("access_token", token);
    upUrl.searchParams.set("path", remotePath);
    upUrl.searchParams.set("uploadid", pre.uploadid);
    upUrl.searchParams.set("partseq", String(i));
    const form = new FormData();
    form.append("file", new Blob([chunk]), path.basename(remotePath));
    await apiPost(upUrl, form);
  }

  const createUrl = new URL(API_BASE);
  createUrl.searchParams.set("method", "create");
  createUrl.searchParams.set("access_token", token);
  const createBody = new URLSearchParams({
    path: remotePath,
    size: String(size),
    isdir: "0",
    uploadid: pre.uploadid,
    block_list: JSON.stringify(blockList),
    rtype: "3",
  });
  const created = await apiPost(createUrl, createBody, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return { path: created.path, size: created.size, fs_id: created.fs_id };
}

export async function createShareLink(remotePaths, { password, expireDays = 0 } = {}) {
  const token = await getValidAccessToken();
  const paths = Array.isArray(remotePaths) ? remotePaths : [remotePaths];
  const found = [];
  for (const p of paths) {
    const match = (await searchFiles(path.basename(p), path.dirname(p))).find(
      (f) => f.path === p
    );
    if (!match) throw new Error(`File not found on Baidu Netdisk: ${p}`);
    found.push(match.fs_id);
  }
  const url = new URL(SHARE_URL);
  url.searchParams.set("access_token", token);
  const body = new URLSearchParams({
    fid_list: JSON.stringify(found),
    schannel: password ? "4" : "0",
    period: String(expireDays),
  });
  if (password) body.set("pwd", password);
  // Note: share creation requires your app to have the "netdisk" share
  // permission approved in the developer console; not all app types get it.
  const data = await apiPost(url, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return { link: data.link, shareid: data.shareid, password: password || null };
}
