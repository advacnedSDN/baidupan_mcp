import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listDir,
  searchFiles,
  downloadFile,
  uploadFile,
  createShareLink,
  createFolder,
  deletePaths,
  movePaths,
  renamePath,
} from "./baiduClient.js";

function ok(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(err) {
  return {
    content: [{ type: "text", text: `Error: ${err.message}` }],
    isError: true,
  };
}

/** Builds a fresh McpServer instance with all Baidu Netdisk tools registered. */
export function createMcpServer() {
  const server = new McpServer({
    name: "baidu-netdisk-mcp",
    version: "0.2.0",
  });

  server.registerTool(
    "baidu_list_dir",
    {
      title: "List a Baidu Netdisk directory",
      description: "List files and subfolders under a given path on Baidu Netdisk (百度网盘).",
      inputSchema: { dir: z.string().default("/").describe("Absolute netdisk path, e.g. /我的文档") },
    },
    async ({ dir }) => {
      try {
        return ok(await listDir(dir));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "baidu_search_files",
    {
      title: "Search files on Baidu Netdisk",
      description: "Recursively search for files/folders by keyword under a given path.",
      inputSchema: {
        keyword: z.string().describe("Filename keyword to search for"),
        dir: z.string().default("/").describe("Directory to search under"),
      },
    },
    async ({ keyword, dir }) => {
      try {
        return ok(await searchFiles(keyword, dir));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "baidu_download_file",
    {
      title: "Download a file from Baidu Netdisk",
      description: "Download a file from Baidu Netdisk to a local path on this machine.",
      inputSchema: {
        remotePath: z.string().describe("Full path of the file on Baidu Netdisk"),
        localPath: z.string().describe("Local filesystem path to save the file to"),
      },
    },
    async ({ remotePath, localPath }) => {
      try {
        return ok(await downloadFile(remotePath, localPath));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "baidu_upload_file",
    {
      title: "Upload a file to Baidu Netdisk",
      description: "Upload a local file to a given path on Baidu Netdisk, overwriting if it exists.",
      inputSchema: {
        localPath: z.string().describe("Local filesystem path of the file to upload"),
        remotePath: z.string().describe("Destination path on Baidu Netdisk"),
      },
    },
    async ({ localPath, remotePath }) => {
      try {
        return ok(await uploadFile(localPath, remotePath));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "baidu_create_share_link",
    {
      title: "Create a Baidu Netdisk share link",
      description:
        "Create a share link for one or more files/folders. Note: requires your app to have share permission approved in the Baidu developer console.",
      inputSchema: {
        remotePaths: z.array(z.string()).describe("Paths of files/folders to share"),
        password: z.string().optional().describe("Optional extraction password (4 chars)"),
        expireDays: z
          .number()
          .optional()
          .default(0)
          .describe("Days until link expires, 0 = never"),
      },
    },
    async ({ remotePaths, password, expireDays }) => {
      try {
        return ok(await createShareLink(remotePaths, { password, expireDays }));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "baidu_create_folder",
    {
      title: "Create a folder on Baidu Netdisk",
      description:
        "Create a folder (including missing parent folders) at the given path. Fails if something already exists there.",
      inputSchema: {
        path: z.string().describe("Absolute netdisk path of the folder to create, e.g. /工作/2026"),
      },
    },
    async ({ path }) => {
      try {
        return ok(await createFolder(path));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "baidu_delete",
    {
      title: "Delete files/folders on Baidu Netdisk",
      description:
        "Delete one or more files or folders (folders are deleted with their contents). Deleted items go to the Baidu Netdisk recycle bin.",
      inputSchema: {
        paths: z.array(z.string()).min(1).describe("Absolute netdisk paths to delete"),
      },
    },
    async ({ paths }) => {
      try {
        return ok(await deletePaths(paths));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "baidu_move",
    {
      title: "Move files/folders on Baidu Netdisk",
      description:
        "Move one or more files or folders into a destination folder, optionally renaming them.",
      inputSchema: {
        items: z
          .array(
            z.object({
              path: z.string().describe("Absolute netdisk path of the item to move"),
              destDir: z.string().describe("Destination folder path"),
              newName: z.string().optional().describe("New name at the destination; defaults to the current name"),
            })
          )
          .min(1),
        onConflict: z
          .enum(["fail", "newcopy", "overwrite", "skip"])
          .default("fail")
          .describe("What to do if the destination name is taken"),
      },
    },
    async ({ items, onConflict }) => {
      try {
        return ok(await movePaths(items, onConflict));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "baidu_rename",
    {
      title: "Rename a file/folder on Baidu Netdisk",
      description: "Rename a file or folder in place (same parent folder).",
      inputSchema: {
        path: z.string().describe("Absolute netdisk path of the item to rename"),
        newName: z.string().describe("New name (bare name, not a path)"),
      },
    },
    async ({ path, newName }) => {
      try {
        return ok(await renamePath(path, newName));
      } catch (e) {
        return fail(e);
      }
    }
  );

  return server;
}
