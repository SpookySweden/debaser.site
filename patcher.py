import os
import sys
import re
import subprocess
import tkinter as tk
from tkinter import messagebox

def get_canonical_project_root():
    if getattr(sys, 'frozen', False):
        start_dir = os.path.dirname(sys.executable)
    else:
        start_dir = os.path.dirname(os.path.abspath(__file__))
    
    curr = start_dir
    while curr and os.path.dirname(curr) != curr:
        if os.path.exists(os.path.join(curr, "package.json")):
            return curr
        curr = os.path.dirname(curr)
    
    fallback = r"C:\Users\Luke\Desktop\localcode"
    if os.path.exists(os.path.join(fallback, "package.json")):
        return fallback
        
    return None

PROJECT_ROOT = get_canonical_project_root()
TARGET_FILE = os.path.join(PROJECT_ROOT, "app", "lib", "web", "media-servers.ts") if PROJECT_ROOT else None

def run_git_cmd(args):
    res = subprocess.run(["git"] + args, cwd=PROJECT_ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        return False, res.stderr.strip() or res.stdout.strip()
    return True, res.stdout.strip()

def patch_servers():
    vidsrc_url = entry_vidsrc.get().strip()
    twoembed_url = entry_2embed.get().strip()

    if not vidsrc_url or not twoembed_url:
        messagebox.showerror("Input Error", "Please enter valid base URLs for both embed providers.")
        return

    try:
        if not PROJECT_ROOT or not os.path.exists(TARGET_FILE):
            messagebox.showerror("Error", f"Could not locate target file inside project root:\n{PROJECT_ROOT}")
            return

        run_git_cmd(["pull", "--rebase", "--autostash", "origin", "main"])

        with open(TARGET_FILE, "r", encoding="utf-8") as f:
            content = f.read()

        inner_servers = f'''// SERVERS-START
  {{
    id: 'server1',
    label: 'VidSrc',
    base: '{vidsrc_url}',
    listPath: '*',
    play: {{
      movie: '/embed/movie?tmdb={{tmdb}}',
      tv: '/embed/tv?tmdb={{tmdb}}&season={{season}}&episode={{episode}}',
    }},
  }},
  {{
    id: 'server2',
    label: '2embed',
    base: '{twoembed_url}',
    listPath: '*',
    play: {{
      movie: '/embed/{{tmdb}}',
      tv: '/embedtv/{{tmdb}}&s={{season}}&e={{episode}}',
    }},
  }},
// SERVERS-END'''

        pattern = r"//\s*SERVERS-START[\s\S]*?//\s*SERVERS-END"

        if re.search(pattern, content):
            new_content = re.sub(pattern, inner_servers, content)
        else:
            messagebox.showerror("Error", "Could not locate markers in media-servers.ts.")
            return

        with open(TARGET_FILE, "w", encoding="utf-8") as f:
            f.write(new_content)

        ok, err = run_git_cmd(["add", "app/lib/web/media-servers.ts"])
        if not ok:
            messagebox.showerror("Git Add Error", err)
            return

        ok, err = run_git_cmd(["commit", "-m", "chore: update media server config"])
        if not ok:
            # If nothing changed or amend needed
            run_git_cmd(["commit", "--amend", "--no-edit"])

        ok, err = run_git_cmd(["push", "origin", "main", "--force"])
        if not ok:
            messagebox.showerror("Git Push Error", f"Push failed:\n{err}")
            return

        messagebox.showinfo("Success", "Patched media-servers.ts & deployed changes!")
    except Exception as e:
        messagebox.showerror("Execution Failed", str(e))

def unpatch_servers():
    try:
        if not PROJECT_ROOT or not os.path.exists(TARGET_FILE):
            messagebox.showerror("Error", f"Could not locate target file inside project root:\n{PROJECT_ROOT}")
            return

        # Automatically soft reset the last commit so the patch commit is completely undone from history log
        run_git_cmd(["reset", "--soft", "HEAD^"])

        with open(TARGET_FILE, "r", encoding="utf-8") as f:
            content = f.read()

        clean_placeholders = '''// SERVERS-START
  // (Placeholder slots)
// SERVERS-END'''

        pattern = r"//\s*SERVERS-START[\s\S]*?//\s*SERVERS-END"

        if re.search(pattern, content):
            new_content = re.sub(pattern, clean_placeholders, content)
        else:
            messagebox.showerror("Error", "Could not locate markers in media-servers.ts.")
            return

        with open(TARGET_FILE, "w", encoding="utf-8") as f:
            f.write(new_content)

        ok, err = run_git_cmd(["add", "app/lib/web/media-servers.ts"])
        if not ok:
            messagebox.showerror("Git Add Error", err)
            return

        ok, err = run_git_cmd(["commit", "-m", "chore: reset server placeholders"])
        if not ok:
            run_git_cmd(["commit", "--amend", "--no-edit"])

        # Force push to overwrite remote log, scrubbing the patch commit entirely from GitHub
        ok, err = run_git_cmd(["push", "origin", "main", "--force"])
        if not ok:
            messagebox.showerror("Git Push Error", f"Push failed:\n{err}")
            return

        messagebox.showinfo("Cleaned", "Successfully unpatched, scrubbed commit history, and pushed clean state!")
    except Exception as e:
        messagebox.showerror("Execution Failed", str(e))

# UI Setup
root = tk.Tk()
root.title("Debaser Stream Manager")
root.geometry("420x310")
root.configure(bg="#121212")

lbl_title = tk.Label(root, text="Debaser Stream Patcher & Cleaner", fg="#FFE600", bg="#121212", font=("Segoe UI", 11, "bold"))
lbl_title.pack(pady=(15, 5))

frame_inputs = tk.Frame(root, bg="#121212")
frame_inputs.pack(pady=10, fill="x", padx=15)

tk.Label(frame_inputs, text="VidSrc Base URL:", fg="#FFFFFF", bg="#121212", font=("Segoe UI", 9)).grid(row=0, column=0, sticky="w", pady=5)
entry_vidsrc = tk.Entry(frame_inputs, width=32)
entry_vidsrc.insert(0, "https://vidsrc.me")
entry_vidsrc.grid(row=0, column=1, pady=5, padx=5)

tk.Label(frame_inputs, text="2embed Base URL:", fg="#FFFFFF", bg="#121212", font=("Segoe UI", 9)).grid(row=1, column=0, sticky="w", pady=5)
entry_2embed = tk.Entry(frame_inputs, width=32)
entry_2embed.insert(0, "https://www.2embed.cc")
entry_2embed.grid(row=1, column=1, pady=5, padx=5)

btn_patch = tk.Button(
    root, 
    text="[ ⚡ SAFE PATCH & PUBLISH ]", 
    command=patch_servers, 
    bg="#FFE600", 
    fg="#000000", 
    font=("Segoe UI", 10, "bold"),
    padx=10,
    pady=5
)
btn_patch.pack(pady=5)

btn_unpatch = tk.Button(
    root, 
    text="[ ↩ UNPATCH & CLEAN ]", 
    command=unpatch_servers, 
    bg="#333333", 
    fg="#FF5555", 
    font=("Segoe UI", 10, "bold"),
    padx=10,
    pady=5
)
btn_unpatch.pack(pady=5)

root.mainloop()