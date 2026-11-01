// Debaser Servers: Luke's desktop program for the media servers WEB reads (SPEC-media-servers.md).
//
// It edits the server list in app/lib/web/media-servers.ts (only the lines between the SERVERS markers), tests a
// server in plain words, and publishes: a quick check of the list file (its lint and the two server-list checks) first, then commit and push to
// main, then it waits until the live site runs the new list (/api/web/media/servers-version) and starts one
// extra WEB update straight away, through the database's own hourly call (the lock never leaves the database).
//
// Build: tools/server-editor/build.cmd (Windows' own C# compiler; nothing is downloaded). C# 5, .NET Framework 4.
// Keep ListText in step with serverListText() in media-servers.ts.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace DebaserServers
{
    class Server
    {
        public string Id, Label, Base, ListPath, Movie, Tv, Series, Other;
        public Server Copy() { return (Server)MemberwiseClone(); }
        public override string ToString() { return Label + "    " + Base; }
    }

    static class Store
    {
        public const string Repo = @"C:\Users\Luke\Desktop\localcode";
        public const string RelativeFile = "app/lib/web/media-servers.ts";
        public const string Site = "https://debaser-site.vercel.app";
        public static string FilePath { get { return Path.Combine(Repo, "app", "lib", "web", "media-servers.ts"); } }

        const string Start = "// SERVERS-START";
        const string End = "// SERVERS-END";
        static readonly Regex Line = new Regex(@"^\s*\{ id: '([^']*)', label: '([^']*)', base: '([^']*)', listPath: '([^']*)', play: \{ movie: '([^']*)', tv: '([^']*)'(?:, series: '([^']*)')?(?:, other: '([^']*)')? \} \},\s*$");

        public static List<Server> Parse(string text, out string error)
        {
            error = null;
            var lines = text.Replace("\r\n", "\n").Split('\n');
            int s = Array.FindIndex(lines, l => l.Trim() == Start);
            int e = Array.FindIndex(lines, l => l.Trim() == End);
            if (s < 0 || e < s) { error = "The server list has lost its SERVERS-START / SERVERS-END lines."; return null; }
            var list = new List<Server>();
            for (int i = s + 1; i < e; i++)
            {
                if (lines[i].Trim().Length == 0) continue;
                var m = Line.Match(lines[i]);
                if (!m.Success) { error = "Line " + (i + 1) + " of media-servers.ts was edited by hand in a shape this program can't read."; return null; }
                list.Add(new Server
                {
                    Id = m.Groups[1].Value, Label = m.Groups[2].Value, Base = m.Groups[3].Value, ListPath = m.Groups[4].Value,
                    Movie = m.Groups[5].Value, Tv = m.Groups[6].Value,
                    Series = m.Groups[7].Success ? m.Groups[7].Value : null, Other = m.Groups[8].Success ? m.Groups[8].Value : null
                });
            }
            return list;
        }

        public static string Render(List<Server> servers, string original)
        {
            string nl = original.Contains("\r\n") ? "\r\n" : "\n";
            var lines = original.Replace("\r\n", "\n").Split('\n').ToList();
            int s = lines.FindIndex(l => l.Trim() == Start);
            int e = lines.FindIndex(l => l.Trim() == End);
            var fresh = servers.Select(x => "  { id: '" + x.Id + "', label: '" + x.Label + "', base: '" + x.Base + "', listPath: '" + x.ListPath +
                "', play: { movie: '" + x.Movie + "', tv: '" + x.Tv + "'" + (x.Series != null ? ", series: '" + x.Series + "'" : "") +
                (x.Other != null ? ", other: '" + x.Other + "'" : "") + " } },");
            lines.RemoveRange(s + 1, e - s - 1);
            lines.InsertRange(s + 1, fresh);
            return string.Join(nl, lines);
        }

        // The same text serverListText() builds on the site, so the two fingerprints match.
        public static string ListText(List<Server> servers)
        {
            var sb = new StringBuilder();
            foreach (var x in servers)
                sb.Append(string.Join("|", new[] { x.Id, x.Label, x.Base, x.ListPath, x.Movie, x.Tv, x.Other ?? "", x.Series ?? "" })).Append('\n');
            return sb.ToString();
        }

        public static string Version(List<Server> servers)
        {
            using (var sha = SHA256.Create())
            {
                var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(ListText(servers)));
                return string.Concat(hash.Select(b => b.ToString("x2"))).Substring(0, 16);
            }
        }

        public static string IdFor(string label, IEnumerable<Server> others)
        {
            string id = Regex.Replace(label.ToLowerInvariant(), "[^a-z0-9]+", "_").Trim('_');
            if (id.Length == 0) id = "server";
            if (char.IsDigit(id[0])) id = "s_" + id;
            if (id.Length > 36) id = id.Substring(0, 36).TrimEnd('_');
            string candidate = id; int n = 2;
            while (others.Any(o => o.Id == candidate)) candidate = id + "_" + n++;
            return candidate;
        }

        static readonly Regex LabelShape = new Regex(@"^[A-Z0-9][A-Z0-9 ._-]{0,29}$");
        static readonly Regex PathShape = new Regex(@"^/(?!.*\.\.)[A-Za-z0-9._~/-]{1,200}$");
        static readonly Regex PatternShape = new Regex(@"^/(?!.*\.\.)[A-Za-z0-9._~/{}-]{1,200}$");

        // Null when the server is fine; otherwise what is wrong, in plain words. Tidies what it can first.
        public static string Check(Server x, IEnumerable<Server> others)
        {
            x.Label = (x.Label ?? "").Trim().ToUpperInvariant();
            x.Base = (x.Base ?? "").Trim().TrimEnd('/');
            x.ListPath = (x.ListPath ?? "").Trim();
            x.Movie = (x.Movie ?? "").Trim();
            x.Tv = (x.Tv ?? "").Trim();
            x.Other = string.IsNullOrWhiteSpace(x.Other) ? null : x.Other.Trim();
            x.Series = string.IsNullOrWhiteSpace(x.Series) ? null : x.Series.Trim();
            if (!LabelShape.IsMatch(x.Label)) return "The NAME must be letters, digits and spaces, 30 at most (it is shown in capitals).";
            if (others.Any(o => o.Label == x.Label)) return "Another server already has the name " + x.Label + ".";
            Uri uri;
            if (!Uri.TryCreate(x.Base, UriKind.Absolute, out uri) || uri.Scheme != "https" || !uri.IsDefaultPort || uri.AbsolutePath != "/" || uri.Query.Length > 0 || uri.UserInfo.Length > 0)
                return "The ADDRESS must be https:// and the server's name only, like https://media.example.com";
            x.Base = "https://" + uri.Host;
            if (x.ListPath != "*" && !PathShape.IsMatch(x.ListPath)) return "The LIST FILE PATH must start with / and be a plain path, like /debaser/list.json, or be * for a server with no list file.";
            if (!PatternShape.IsMatch(x.Movie) || !x.Movie.Contains("{tmdb}")) return "The FILM PLAYER pattern must start with / and contain {tmdb}.";
            if (!PatternShape.IsMatch(x.Tv) || !x.Tv.Contains("{tmdb}") || !x.Tv.Contains("{season}") || !x.Tv.Contains("{episode}"))
                return "The EPISODE PLAYER pattern must start with / and contain {tmdb}, {season} and {episode}.";
            if (x.Series != null && (!PatternShape.IsMatch(x.Series) || !x.Series.Contains("{tmdb}") || x.Series.Contains("{season}") || x.Series.Contains("{episode}") || x.Series.Contains("{id}")))
                return "The WHOLE-SERIES PLAYER pattern must start with / and contain {tmdb} only (or be left empty).";
            if (x.Other != null && (!PatternShape.IsMatch(x.Other) || !x.Other.Contains("{id}"))) return "The OWN-VIDEO PLAYER pattern must start with / and contain {id} (or be left empty).";
            if (string.IsNullOrEmpty(x.Id)) x.Id = IdFor(x.Label, others);
            return null;
        }
    }

    static class Web
    {
        public class Answer { public int Status; public string Body; public WebHeaderCollection Headers; public string Problem; }

        public static Answer Get(string url, int maxBytes)
        {
            var answer = new Answer();
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 12000; req.ReadWriteTimeout = 12000;
                req.UserAgent = "DebaserServers/1.0 (+https://debaser.site)";
                req.AllowAutoRedirect = true;
                using (var res = (HttpWebResponse)req.GetResponse()) Fill(answer, res, maxBytes);
            }
            catch (WebException ex)
            {
                var res = ex.Response as HttpWebResponse;
                if (res != null) using (res) Fill(answer, res, maxBytes);
                else answer.Problem = ex.Status == WebExceptionStatus.Timeout ? "NO ANSWER (timed out)" : ex.Status == WebExceptionStatus.NameResolutionFailure ? "NO ANSWER (that address doesn't exist)" : "NO ANSWER";
            }
            catch (Exception) { answer.Problem = "NO ANSWER"; }
            return answer;
        }

        static void Fill(Answer answer, HttpWebResponse res, int maxBytes)
        {
            answer.Status = (int)res.StatusCode;
            answer.Headers = res.Headers;
            using (var stream = res.GetResponseStream())
            using (var mem = new MemoryStream())
            {
                var buf = new byte[65536]; int read;
                while (mem.Length < maxBytes && (read = stream.Read(buf, 0, buf.Length)) > 0) mem.Write(buf, 0, read);
                answer.Body = Encoding.UTF8.GetString(mem.ToArray());
            }
        }
    }

    class Run
    {
        public int Code; public List<string> Lines = new List<string>();

        public static Run Start(string file, string args, Action<string> onLine, int timeoutMs)
        {
            var run = new Run();
            var psi = new ProcessStartInfo(file, args)
            {
                WorkingDirectory = Store.Repo, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
            };
            using (var p = new Process { StartInfo = psi })
            {
                DataReceivedEventHandler take = (s, e) => { if (e.Data == null) return; lock (run.Lines) run.Lines.Add(e.Data); if (onLine != null) onLine(e.Data); };
                p.OutputDataReceived += take; p.ErrorDataReceived += take;
                p.Start(); p.BeginOutputReadLine(); p.BeginErrorReadLine();
                if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch { } run.Code = -1; run.Lines.Add("(stopped: it took too long)"); return run; }
                p.WaitForExit();
                run.Code = p.ExitCode;
            }
            return run;
        }

        public static Run Git(string args) { return Start("git", args, null, 120000); }
        public static Run Npm(string args, Action<string> onLine, int timeoutMs) { return Start("cmd.exe", "/c npm " + args, onLine, timeoutMs); }
        public string Tail(int n) { lock (Lines) return string.Join(Environment.NewLine, Lines.Skip(Math.Max(0, Lines.Count - n))); }
    }

    static class Look
    {
        public static readonly Color Back = Color.FromArgb(24, 22, 36);
        public static readonly Color Ink = Color.FromArgb(255, 233, 0);
        public static readonly Color Paper = Color.Black;
        public static readonly Color White = Color.White;
        public static readonly Color Alarm = Color.FromArgb(255, 102, 170);
        public static readonly Font Text = new Font("Consolas", 15f);
        public static readonly Font Big = new Font("Consolas", 22f, FontStyle.Bold);

        public static Button Key(string text, int width)
        {
            var b = new Button { Text = "[ " + text + " ]", Width = width, Height = 56, Font = Text, FlatStyle = FlatStyle.Flat, BackColor = Back, ForeColor = Ink, Margin = new Padding(6) };
            b.FlatAppearance.BorderColor = Ink; b.FlatAppearance.BorderSize = 2;
            return b;
        }

        public static Button MainKey(string text, int width)
        {
            var b = Key(text, width); b.BackColor = Ink; b.ForeColor = Paper; return b;
        }
    }

    class EditForm : Form
    {
        readonly TextBox name = new TextBox(), address = new TextBox(), list = new TextBox(), movie = new TextBox(), tv = new TextBox(), series = new TextBox(), other = new TextBox();
        readonly Label problem = new Label();
        public Server Result;
        readonly Server editing;
        readonly List<Server> others;

        public EditForm(Server existing, List<Server> rest)
        {
            editing = existing; others = rest;
            Text = existing == null ? "Add a server" : "Change " + existing.Label;
            BackColor = Look.Back; ForeColor = Look.Ink; Font = Look.Text;
            Width = 1000; Height = 900; StartPosition = FormStartPosition.CenterParent; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false;

            var flow = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(20), AutoScroll = true };
            Controls.Add(flow);
            Heading(flow, "SERVER");
            Field(flow, "NAME (shown on the SERVER button):", name, existing == null ? "" : existing.Label);
            Field(flow, "ADDRESS (https:// and the server's name):", address, existing == null ? "https://" : existing.Base);
            Field(flow, "LIST FILE PATH on that server (* = no list file: plays any title by its TMDB number):", list, existing == null ? "/debaser/list.json" : existing.ListPath);
            Heading(flow, "FILMS AND FILM SERIES");
            Note(flow, "Films TMDB puts in one series (a TMDB collection) show as one entry with a FILM picker, by themselves.");
            Field(flow, "FILM PLAYER pattern ({tmdb}):", movie, existing == null ? "/debaser/play/movie/{tmdb}" : existing.Movie);
            Heading(flow, "SERIES");
            Field(flow, "WHOLE-SERIES PLAYER pattern ({tmdb}; may be empty):", series, existing == null ? "/debaser/play/tv/{tmdb}" : (existing.Series ?? ""));
            Field(flow, "EPISODE PLAYER pattern ({tmdb}, {season}, {episode}):", tv, existing == null ? "/debaser/play/tv/{tmdb}/{season}/{episode}" : existing.Tv);
            Heading(flow, "OWN VIDEOS (no TMDB number)");
            Field(flow, "OWN-VIDEO PLAYER pattern ({id}; may be empty):", other, existing == null ? "/debaser/play/item/{id}" : (existing.Other ?? ""));
            // The message and the two keys sit in a strip pinned to the bottom, so they are always in view.
            var bottom = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(20, 6, 20, 14), BackColor = Look.Paper };
            problem.AutoSize = true; problem.MaximumSize = new Size(920, 0); problem.ForeColor = Look.Alarm; problem.Margin = new Padding(0, 4, 0, 4);
            bottom.Controls.Add(problem);
            var row = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight };
            var save = Look.MainKey("KEEP THIS", 240); var cancel = Look.Key("CANCEL", 200);
            save.Click += (s, e) => Keep(); cancel.Click += (s, e) => { DialogResult = DialogResult.Cancel; Close(); };
            row.Controls.Add(save); row.Controls.Add(cancel); bottom.Controls.Add(row);
            Controls.Add(bottom);
            flow.BringToFront();
            AcceptButton = save; CancelButton = cancel;
        }

        void Heading(FlowLayoutPanel flow, string text)
        {
            flow.Controls.Add(new Label { Text = "== " + text + " ==", AutoSize = true, Font = new Font("Consolas", 17f, FontStyle.Bold), ForeColor = Look.Ink, Margin = new Padding(0, 16, 0, 2) });
        }

        void Note(FlowLayoutPanel flow, string text)
        {
            flow.Controls.Add(new Label { Text = text, AutoSize = true, MaximumSize = new Size(900, 0), ForeColor = Look.White, Margin = new Padding(0, 2, 0, 2) });
        }

        void Field(FlowLayoutPanel flow, string caption, TextBox box, string value)
        {
            flow.Controls.Add(new Label { Text = caption, AutoSize = true, Margin = new Padding(0, 6, 0, 2) });
            box.Text = value; box.Width = 900; box.Font = Look.Text; box.BackColor = Look.Paper; box.ForeColor = Look.White; box.BorderStyle = BorderStyle.FixedSingle;
            flow.Controls.Add(box);
        }

        void Keep()
        {
            var x = new Server
            {
                Id = editing == null ? null : editing.Id, // a server's id never changes: saved rows carry it
                Label = name.Text, Base = address.Text, ListPath = list.Text, Movie = movie.Text, Tv = tv.Text, Series = series.Text, Other = other.Text
            };
            string wrong = Store.Check(x, others);
            if (wrong != null) { problem.Text = wrong; return; }
            Result = x; DialogResult = DialogResult.OK; Close();
        }
    }

    class MainForm : Form
    {
        readonly ListBox servers = new ListBox();
        readonly TextBox log = new TextBox();
        readonly Label status = new Label();
        readonly List<Button> keys = new List<Button>();
        List<Server> list = new List<Server>();
        List<Server> saved = new List<Server>();
        bool working;

        public MainForm()
        {
            Text = "Debaser Servers"; BackColor = Look.Back; ForeColor = Look.Ink; Font = Look.Text;
            Width = 1180; Height = 900; StartPosition = FormStartPosition.CenterScreen; MinimumSize = new Size(900, 700);

            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 6, Padding = new Padding(18) };
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 40));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 60));
            Controls.Add(layout);

            layout.Controls.Add(new Label { Text = "DEBASER SERVERS", Font = Look.Big, AutoSize = true, Margin = new Padding(0, 0, 0, 10) });

            servers.Dock = DockStyle.Fill; servers.Font = Look.Text; servers.BackColor = Look.Paper; servers.ForeColor = Look.White; servers.BorderStyle = BorderStyle.FixedSingle; servers.ItemHeight = 30;
            servers.DoubleClick += (s, e) => EditSelected();
            layout.Controls.Add(servers);

            var row = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, Margin = new Padding(0, 10, 0, 0) };
            row.Controls.Add(Key(Look.Key("ADD", 160), (s, e) => Add()));
            row.Controls.Add(Key(Look.Key("CHANGE", 190), (s, e) => EditSelected()));
            row.Controls.Add(Key(Look.Key("REMOVE", 190), (s, e) => RemoveSelected()));
            row.Controls.Add(Key(Look.Key("TEST", 160), (s, e) => TestSelected()));
            layout.Controls.Add(row);

            layout.Controls.Add(Key(Look.MainKey("SAVE AND PUBLISH", 420), (s, e) => Publish()));

            status.AutoSize = true; status.MaximumSize = new Size(1100, 0); status.Margin = new Padding(0, 10, 0, 6); status.Font = new Font("Consolas", 16f, FontStyle.Bold);
            layout.Controls.Add(status);

            log.Dock = DockStyle.Fill; log.Multiline = true; log.ReadOnly = true; log.ScrollBars = ScrollBars.Vertical; log.Font = new Font("Consolas", 13f);
            log.BackColor = Look.Paper; log.ForeColor = Look.White; log.BorderStyle = BorderStyle.FixedSingle;
            layout.Controls.Add(log);

            Load += (s, e) => LoadList();
            FormClosing += (s, e) =>
            {
                if (working) { e.Cancel = MessageBox.Show(this, "Publishing is still running. Close anyway?", "Debaser Servers", MessageBoxButtons.YesNo) != DialogResult.Yes; return; }
                if (Changed() && MessageBox.Show(this, "You have changes that are not published. Close and lose them?", "Debaser Servers", MessageBoxButtons.YesNo) != DialogResult.Yes) e.Cancel = true;
            };
        }

        Button Key(Button b, EventHandler click) { b.Click += click; keys.Add(b); return b; }

        void Say(string line)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string>(Say), line); return; }
            log.AppendText(line + Environment.NewLine);
        }

        void Status(string text, bool alarm)
        {
            if (InvokeRequired) { BeginInvoke(new Action<string, bool>(Status), text, alarm); return; }
            status.Text = text; status.ForeColor = alarm ? Look.Alarm : Look.Ink;
        }

        void Busy(bool on)
        {
            if (InvokeRequired) { BeginInvoke(new Action<bool>(Busy), on); return; }
            working = on; foreach (var k in keys) k.Enabled = !on; UseWaitCursor = on;
        }

        bool Changed() { return Store.ListText(list) != Store.ListText(saved); }

        void ShowList(int select)
        {
            servers.Items.Clear();
            foreach (var x in list) servers.Items.Add(x);
            if (list.Count > 0) servers.SelectedIndex = Math.Max(0, Math.Min(select, list.Count - 1));
            if (Changed()) Status("UNPUBLISHED CHANGES. Press SAVE AND PUBLISH when ready.", false);
        }

        void LoadList()
        {
            if (!File.Exists(Store.FilePath)) { Status("CAN'T FIND THE SITE'S FOLDER: " + Store.Repo, true); Busy(true); return; }
            string error;
            var read = Store.Parse(File.ReadAllText(Store.FilePath), out error);
            if (read == null) { Status(error, true); Busy(true); return; }
            list = read; saved = read.Select(x => x.Copy()).ToList();
            ShowList(0);
            Status(list.Count + " SERVER" + (list.Count == 1 ? "" : "S") + " LISTED. Pick one, or ADD a new one.", false);
            Say("Read the list from " + Store.FilePath);
        }

        Server Selected() { return servers.SelectedIndex >= 0 && servers.SelectedIndex < list.Count ? list[servers.SelectedIndex] : null; }

        void Add()
        {
            using (var f = new EditForm(null, list))
                if (f.ShowDialog(this) == DialogResult.OK) { list.Add(f.Result); ShowList(list.Count - 1); Say("Added " + f.Result.Label + " (not published yet)."); }
        }

        void EditSelected()
        {
            var x = Selected(); if (x == null || working) return;
            int at = list.IndexOf(x);
            using (var f = new EditForm(x, list.Where(o => o != x).ToList()))
                if (f.ShowDialog(this) == DialogResult.OK) { list[at] = f.Result; ShowList(at); Say("Changed " + f.Result.Label + " (not published yet)."); }
        }

        void RemoveSelected()
        {
            var x = Selected(); if (x == null) return;
            if (list.Count == 1) { Status("THE SITE NEEDS AT LEAST ONE SERVER. Add another before removing this one.", true); return; }
            if (MessageBox.Show(this, "Remove " + x.Label + "? Its titles leave WEB after you publish.", "Debaser Servers", MessageBoxButtons.YesNo) != DialogResult.Yes) return;
            int at = list.IndexOf(x); list.Remove(x); ShowList(at); Say("Removed " + x.Label + " (not published yet).");
        }

        // ------------------------------------------------------------------ TEST

        void TestSelected()
        {
            var x = Selected(); if (x == null) return;
            Busy(true); Status("TESTING " + x.Label + "...", false);
            Task.Factory.StartNew(() =>
            {
                try { Test(x.Copy()); } catch (Exception ex) { Status("THE TEST STOPPED: " + ex.Message, true); }
                finally { Busy(false); }
            });
        }

        void Test(Server x)
        {
            Say(""); Say("== TEST: " + x.Label + "  (" + x.Base + ")");
            var problems = new List<string>();

            var front = Web.Get(x.Base + "/", 65536);
            bool up = front.Problem == null && front.Status < 500;
            Say("Front page: " + (front.Problem ?? ("answers (HTTP " + front.Status + ")")));
            if (!up) problems.Add("the server is not answering");

            object[] entries = null;
            if (x.ListPath == "*")
            {
                // No list file: the site shows every TMDB title for it, so the players are tried with one film and one show.
                Say("List file: none (*). Every film and show a /web search finds on TMDB gets a button for this server.");
                TryPlayer("Film player", x.Base + x.Movie.Replace("{tmdb}", "603"), problems);
                TryPlayer("Episode player", x.Base + x.Tv.Replace("{tmdb}", "1399").Replace("{season}", "1").Replace("{episode}", "1"), problems);
                if (x.Series != null) TryPlayer("Whole-series player", x.Base + x.Series.Replace("{tmdb}", "1399"), problems);
                if (problems.Count == 0) Status(x.Label + ": ALL GOOD.", false);
                else Status(x.Label + ": " + string.Join("; ", problems.Distinct()).ToUpperInvariant() + ".", true);
                return;
            }
            var listAnswer = Web.Get(x.Base + x.ListPath, 16 * 1024 * 1024);
            if (listAnswer.Problem != null) { Say("List file: " + listAnswer.Problem); problems.Add("the list file can't be read"); }
            else if (listAnswer.Status != 200) { Say("List file: NOT FOUND (HTTP " + listAnswer.Status + ") at " + x.Base + x.ListPath); problems.Add("the list file isn't there"); }
            else
            {
                try { entries = new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.DeserializeObject(listAnswer.Body) as object[]; } catch { entries = null; }
                if (entries == null) { Say("List file: answers, but it is NOT A LIST (it must be a JSON array)."); problems.Add("the list file is not a list"); }
            }

            string firstFilm = null; string firstShow = null; string firstWhole = null; int season = 0, episode = 0;
            if (entries != null)
            {
                int films = 0, episodes = 0, wholeShows = 0, own = 0, unusable = 0;
                foreach (var e in entries)
                {
                    var d = e as Dictionary<string, object>;
                    string type = d != null && d.ContainsKey("type") && d["type"] != null ? d["type"].ToString().ToLowerInvariant() : "";
                    string tmdb = d != null && d.ContainsKey("tmdb_id") && d["tmdb_id"] != null ? d["tmdb_id"].ToString() : "";
                    bool hasTitle = d != null && d.ContainsKey("title") && d["title"] != null && d["title"].ToString().Trim().Length > 0;
                    bool numbered = Regex.IsMatch(tmdb, @"^\d{1,9}$");
                    if (!hasTitle) { unusable++; continue; }
                    bool show = type == "tv" || type == "show" || type == "series" || type == "episode";
                    bool hasSeason = d.ContainsKey("season") && d["season"] != null, hasEpisode = d.ContainsKey("episode") && d["episode"] != null;
                    if (show && numbered && hasSeason && hasEpisode)
                    {
                        episodes++;
                        if (firstShow == null) { firstShow = tmdb; int.TryParse(d["season"].ToString(), out season); int.TryParse(d["episode"].ToString(), out episode); }
                    }
                    else if (show && numbered && !hasSeason && !hasEpisode) { wholeShows++; if (firstWhole == null) firstWhole = tmdb; }
                    else if (numbered && !show) { films++; if (firstFilm == null) firstFilm = tmdb; }
                    else if (d.ContainsKey("id") && d["id"] != null) own++;
                    else unusable++;
                }
                Say("List file: " + entries.Length + " entries - " + films + " films, " + episodes + " episodes, " + wholeShows + " whole shows, " + own + " own videos" +
                    (unusable > 0 ? ", " + unusable + " that can't be used" : "") + ". (Film series are found through TMDB once the site reads the list.)");
                if (entries.Length == 0) problems.Add("the list is empty");
                if (wholeShows > 0 && x.Series == null) { Say("   Whole shows are listed, but this server has no WHOLE-SERIES PLAYER pattern, so they can't play."); problems.Add("whole shows but no whole-series player"); }
            }

            int tried = 0;
            if (firstFilm != null) { TryPlayer("Film player", x.Base + x.Movie.Replace("{tmdb}", firstFilm), problems); tried++; }
            if (firstShow != null) { TryPlayer("Episode player", x.Base + x.Tv.Replace("{tmdb}", firstShow).Replace("{season}", season.ToString()).Replace("{episode}", episode.ToString()), problems); tried++; }
            string wholeNumber = firstWhole ?? firstShow;
            if (x.Series != null && wholeNumber != null) { TryPlayer("Whole-series player", x.Base + x.Series.Replace("{tmdb}", wholeNumber), problems); tried++; }
            if (tried == 0) Say("Players: nothing in the list to try them with.");

            if (problems.Count == 0) Status(x.Label + ": ALL GOOD.", false);
            else Status(x.Label + ": " + string.Join("; ", problems.Distinct()).ToUpperInvariant() + ".", true);
        }

        // One player page: does it answer, and does it let debaser.site show it in a frame?
        void TryPlayer(string name, string url, List<string> problems)
        {
            var p = Web.Get(url, 65536);
            if (p.Problem != null) { Say(name + ": " + p.Problem + "  (" + url + ")"); problems.Add(name.ToLowerInvariant() + " doesn't answer"); return; }
            if (p.Status >= 400) { Say(name + ": HTTP " + p.Status + " at " + url); problems.Add(name.ToLowerInvariant() + " isn't there"); return; }
            string xfo = p.Headers["X-Frame-Options"] ?? "";
            string csp = p.Headers["Content-Security-Policy"] ?? "";
            var fa = Regex.Match(csp, @"frame-ancestors([^;]*)", RegexOptions.IgnoreCase);
            bool allowedByCsp = fa.Success && (fa.Groups[1].Value.Contains("debaser.site") || fa.Groups[1].Value.Contains("debaser-site.vercel.app") || fa.Groups[1].Value.Contains("*"));
            bool blocked = (fa.Success && !allowedByCsp) || (!fa.Success && Regex.IsMatch(xfo, "deny|sameorigin", RegexOptions.IgnoreCase));
            Say(name + ": answers (" + url + ")");
            if (blocked) { Say("   ...but it does NOT let debaser.site show it (see docs/media-server-setup.md, step 4)."); problems.Add("the players block debaser.site"); }
            else Say("   ...and debaser.site is allowed to show it.");
        }

        // ------------------------------------------------------------------ PUBLISH

        void Publish()
        {
            if (list.Count == 0) { Status("THE SITE NEEDS AT LEAST ONE SERVER.", true); return; }
            if (MessageBox.Show(this, "Publish the server list to the live site?\n\nA quick check of the list runs first (under a minute); nothing goes live unless it passes.", "Debaser Servers", MessageBoxButtons.YesNo) != DialogResult.Yes) return;
            var wanted = list.Select(x => x.Copy()).ToList();
            var before = saved.Select(x => x.Copy()).ToList();
            Busy(true);
            Task.Factory.StartNew(() =>
            {
                try { DoPublish(wanted, before); } catch (Exception ex) { Status("PUBLISHING STOPPED: " + ex.Message, true); }
                finally { Busy(false); }
            });
        }

        void DoPublish(List<Server> wanted, List<Server> before)
        {
            Say(""); Say("== SAVE AND PUBLISH");

            Status("CHECKING THE SITE'S FOLDER...", false);
            var branch = Run.Git("rev-parse --abbrev-ref HEAD");
            if (branch.Code != 0 || branch.Tail(1).Trim() != "main") { Status("THE SITE'S FOLDER IS NOT ON main. Nothing was changed.", true); return; }
            var dirty = Run.Git("status --porcelain").Lines.Where(l => l.Length > 3 && !l.StartsWith("??") && !l.EndsWith("media-servers.ts")).ToList();
            if (dirty.Count > 0)
            {
                Say("Unsaved work in the folder (another session may be working there):"); foreach (var l in dirty.Take(8)) Say("   " + l);
                Status("ANOTHER PIECE OF WORK IS UNSAVED IN THE SITE'S FOLDER. Try again when it's finished. Nothing was changed.", true); return;
            }
            Run.Git("checkout -- " + Store.RelativeFile);
            var pull = Run.Git("pull --ff-only origin main");
            if (pull.Code != 0) { Say(pull.Tail(6)); Status("COULDN'T GET THE LATEST SITE FROM GITHUB. Nothing was changed.", true); return; }

            string original = File.ReadAllText(Store.FilePath);
            string error;
            var current = Store.Parse(original, out error);
            if (current == null) { Status(error, true); return; }
            string fresh = Store.Render(wanted, original);
            if (fresh == original) { Status("NOTHING TO PUBLISH: THE LIVE LIST IS ALREADY THIS ONE.", false); MarkSaved(wanted); return; }
            File.WriteAllText(Store.FilePath, fresh, new UTF8Encoding(false));
            Say("Wrote the new list into " + Store.RelativeFile);

            // The site's tools are only installed when they're missing; a reinstall every time cost minutes for nothing.
            if (!Directory.Exists(Path.Combine(Store.Repo, "node_modules")))
            {
                Status("GETTING THE SITE'S TOOLS READY...", false);
                Run.Npm("install --no-audit --no-fund", null, 600000);
            }

            // Only the list file changed, so the quick check covers just that file: lint it, then the two server-list
            // checks (well-formed ids, labels, addresses and player patterns). The full `npm run verify` stays for code
            // changes; Vercel builds again before anything goes live, and a failed build leaves the old site up.
            Status("RUNNING THE QUICK CHECK (under a minute)...", false);
            int seen = 0;
            var verify = Run.Start("cmd.exe", "/c npx eslint " + Store.RelativeFile + " && npm run checks -- --only check-web-media", line =>
            {
                seen++;
                Status("RUNNING THE QUICK CHECK  (" + seen + " lines so far)", false);
            }, 10 * 60 * 1000);
            string logPath = Path.Combine(Store.Repo, "Temp", "debaser-servers-verify.log");
            try { Directory.CreateDirectory(Path.GetDirectoryName(logPath)); File.WriteAllText(logPath, verify.Tail(100000)); } catch { }
            if (verify.Code != 0)
            {
                Run.Git("checkout -- " + Store.RelativeFile);
                Say("The quick check failed. The last lines:"); Say(verify.Tail(15)); Say("Full log: " + logPath);
                Status("THE QUICK CHECK FAILED, SO NOTHING WAS PUBLISHED. Your list is still here; the end of the log says why.", true);
                return;
            }
            Say("The quick check passed.");

            Status("SAVING AND PUSHING TO GITHUB...", false);
            Run.Git("add " + Store.RelativeFile);
            var commit = Run.Git("commit -m \"" + Summary(before, wanted) + "\"");
            if (commit.Code != 0) { Say(commit.Tail(6)); Run.Git("checkout -- " + Store.RelativeFile); Status("COULDN'T SAVE THE CHANGE. Nothing was published.", true); return; }
            var push = Run.Git("push origin main");
            if (push.Code != 0) { Say(push.Tail(8)); Status("SAVED ON THIS COMPUTER BUT COULDN'T PUSH TO GITHUB. Try SAVE AND PUBLISH again later.", true); return; }
            MarkSaved(wanted);
            Say("Pushed to main.");

            string version = Store.Version(wanted);
            var started = DateTime.Now; bool live = false;
            while ((DateTime.Now - started).TotalMinutes < 20)
            {
                Status("WAITING FOR THE LIVE SITE TO REBUILD (" + (int)(DateTime.Now - started).TotalMinutes + " MIN SO FAR)...", false);
                var a = Web.Get(Store.Site + "/api/web/media/servers-version?t=" + DateTime.Now.Ticks, 4096);
                if (a.Problem == null && a.Status == 200 && a.Body != null && a.Body.Contains("\"" + version + "\"")) { live = true; break; }
                System.Threading.Thread.Sleep(15000);
            }
            if (!live) { Status("PUBLISHED, BUT THE LIVE SITE HASN'T REBUILT AFTER 20 MINUTES. The normal hourly update will still pick it up.", true); return; }
            Say("The live site runs the new list.");

            Status("STARTING AN EXTRA WEB UPDATE...", false);
            const string kick = "select net.http_post(url := 'https://debaser-site.vercel.app/api/web/ingest', headers := jsonb_build_object('Content-Type', 'application/json', 'x-web-ingest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'web_ingest_secret' limit 1)), body := '{}'::jsonb, timeout_milliseconds := 60000)";
            var db = Run.Start("node", "scripts/db.cjs --write \"" + kick + "\"", null, 180000);
            if (db.Code != 0) { Say(db.Tail(8)); Status("PUBLISHED AND LIVE, BUT THE EXTRA UPDATE DIDN'T START. The normal hourly update (minute 17) will pick it up.", true); return; }
            Status("DONE. PUBLISHED, LIVE, AND AN EXTRA UPDATE IS RUNNING: NEW TITLES SHOW ON /web IN ABOUT A MINUTE.", false);
            Say("Started the extra WEB update.");
        }

        void MarkSaved(List<Server> wanted)
        {
            if (InvokeRequired) { BeginInvoke(new Action<List<Server>>(MarkSaved), wanted); return; }
            saved = wanted.Select(x => x.Copy()).ToList();
        }

        static string Summary(List<Server> before, List<Server> after)
        {
            var parts = new List<string>();
            var added = after.Where(a => !before.Any(b => b.Id == a.Id)).Select(a => a.Label).ToList();
            var removed = before.Where(b => !after.Any(a => a.Id == b.Id)).Select(b => b.Label).ToList();
            var changed = after.Where(a => before.Any(b => b.Id == a.Id && Store.ListText(new List<Server> { b }) != Store.ListText(new List<Server> { a }))).Select(a => a.Label).ToList();
            if (added.Count > 0) parts.Add("added " + string.Join(", ", added));
            if (changed.Count > 0) parts.Add("changed " + string.Join(", ", changed));
            if (removed.Count > 0) parts.Add("removed " + string.Join(", ", removed));
            if (parts.Count == 0) parts.Add("reordered");
            return ("WEB servers: " + string.Join("; ", parts) + " (Debaser Servers program)").Replace("\"", "'");
        }
    }

    static class Program
    {
        [STAThread]
        static void Main()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }
}
