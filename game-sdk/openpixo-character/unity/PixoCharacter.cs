// SPDX-License-Identifier: Apache-2.0
// Plays a character whose gear can be changed: one flat picture per part and ready-made corner positions per frame. Unity 2021.3 and newer.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;
using UnityEngine;
using UnityEngine.Rendering;

// The parts of one character belong together: without the group, parts of two characters that stand in front of each other would mix.
[RequireComponent(typeof(SortingGroup))]
public class PixoCharacter : MonoBehaviour {
    const float Steps = 8f, Blend = 0.09f;

    // Which group of Wear an armour layer belongs to.
    static readonly Dictionary<string, string> Group = new Dictionary<string, string> {
        { "head+", "head" }, { "torso+", "body" }, { "armN+", "arm" }, { "armF+", "arm" }, { "legN+", "leg" }, { "legF+", "leg" }, { "weapon", "weapon" }, { "bow", "weapon" }, { "staff", "weapon" }, { "string", "weapon" }, { "shot", "weapon" }, { "shield", "shield" }, { "cape", "cape" },
    };
    static Shader shader;

    // What it wears, by slot: head, body, arm, leg, weapon, cape, shield. Items lists what there is. Change it with PutOn and TakeOff.
    public readonly Dictionary<string, string> Wear = new Dictionary<string, string>();
    public readonly Dictionary<string, List<string>> Items = new Dictionary<string, List<string>>();
    public string Motion = "idle";
    public float Seconds;
    public float Speed = 1;
    // In front of what has a lower number and behind what has a higher one, within the sorting layer of its SortingGroup.
    public int Order { get => Together.sortingOrder; set => Together.sortingOrder = value; }
    SortingGroup Together => TryGetComponent<SortingGroup>(out var group) ? group : gameObject.AddComponent<SortingGroup>();
    // Play on its own; switch off to set the time with Pose.
    public bool Running = true;
    // The moment a blow lands; a motion that does not repeat is over.
    public event Action Hit;
    public event Action<string> Finished;

    class Track { public int Rows, Cols, Corners; public Vector3[] Positions; public int[] Triangles; public Color[] Colours; public float[] Uv; public Dictionary<string, float[]> Uvs; public Dictionary<string, Vector2> Off; }
    class Picture { public Texture2D Texture; public float X, Y, W, H; }
    class Missile { public string Picture; public Vector2 Tail; public float Size; }
    class Clip { public int From, Count; public float Seconds, Hit; public bool Loop; }

    readonly Dictionary<string, Track> tracks = new Dictionary<string, Track>();
    readonly Dictionary<string, Picture> pictures = new Dictionary<string, Picture>();
    readonly Dictionary<string, Clip> clips = new Dictionary<string, Clip>();
    readonly Dictionary<string, float[]> blades = new Dictionary<string, float[]>();
    // Weapons that are not swung, what they shoot, the types that leave no hand for a shield and those the far hand holds.
    Dictionary<string, string> types;
    readonly Dictionary<string, Missile> shots = new Dictionary<string, Missile>();
    string[] twoHanded = new string[0], farHand = new string[0];
    string played = "";
    readonly Dictionary<string, Vector2[]> places = new Dictionary<string, Vector2[]>();
    readonly Dictionary<string, Dictionary<string, string>> outfits = new Dictionary<string, Dictionary<string, string>>();
    readonly List<MeshRenderer> pool = new List<MeshRenderer>();
    Dictionary<string, Vector3[]> last = new Dictionary<string, Vector3[]>(), from = new Dictionary<string, Vector3[]>();
    string[][] orders;
    int[] order, face;
    string[] faces;
    int used;
    float since = 9;
    bool toldHit, toldEnd;

    public int FrameCount(string motion) => clips[motion].Count;
    public float Length(string motion) => clips[motion].Seconds;
    public bool Loops(string motion) => clips[motion].Loop;

    // A folder of files. StreamingAssets is none on Android and in browsers: load what is in it with UnityWebRequest and hand it to the other Open.
    public void Open(string dir) => Open(name => File.ReadAllBytes(dir + "/" + name));

    // Reads hero.json, hero.bin and the pictures that hero.json lists, by their names.
    public void Open(Func<string, byte[]> read) {
        var d = (Dictionary<string, object>)Json.Parse(Encoding.UTF8.GetString(read("hero.json")));
        _ = Together; // one that was made before this component asked for it
        if ((string)d["format"] != "pixo-hero" || Json.Int(d["version"]) != 1) throw new InvalidDataException("not a hero package of version 1");
        var bin = read("hero.bin");
        int frames = Json.Int(d["frames"]);
        foreach (var kv in Json.Map(d["pics"])) {
            var p = Json.Map(kv.Value);
            var t = new Texture2D(2, 2, TextureFormat.RGBA32, true);
            t.LoadImage(read((string)p["file"]));
            t.wrapMode = TextureWrapMode.Clamp;
            t.filterMode = FilterMode.Trilinear;
            t.anisoLevel = 8; // folded elbows squeeze a picture in one direction
            pictures[kv.Key] = new Picture { Texture = t, X = Json.Float(p["x"]), Y = Json.Float(p["y"]), W = Json.Float(p["w"]), H = Json.Float(p["h"]) };
        }
        foreach (var kv in Json.Map(d["tracks"])) tracks[kv.Key] = ReadTrack(Json.Map(kv.Value), bin, frames);
        foreach (var kv in Json.Map(d["motions"])) {
            var m = Json.Map(kv.Value);
            clips[kv.Key] = new Clip { From = Json.Int(m["from"]), Count = Json.Int(m["count"]), Seconds = Json.Float(m["seconds"]), Loop = (bool)m["loop"], Hit = m.ContainsKey("hit") ? Json.Float(m["hit"]) : -1 };
        }
        types = d.ContainsKey("types") ? Texts(d["types"]) : null;
        if (types != null) {
            twoHanded = Json.Strings(d["twoHanded"]);
            farHand = Json.Strings(d["farHand"]);
            foreach (var kv in Json.Map(d["shots"])) { var q = Json.Map(kv.Value); var tail = Json.Floats(q["tail"]); shots[kv.Key] = new Missile { Picture = (string)q["picture"], Tail = new Vector2(tail[0], tail[1]), Size = Json.Float(q["size"]) }; }
        }
        foreach (var kv in Json.Map(d["blades"])) blades[kv.Key] = Json.Floats(kv.Value);
        var lists = Json.List(d["orders"]);
        orders = new string[lists.Count][];
        for (int i = 0; i < orders.Length; i++) orders[i] = Json.Strings(lists[i]);
        order = Array.ConvertAll(Json.Floats(d["order"]), v => (int)v);
        face = Array.ConvertAll(Json.Floats(d["face"]), v => (int)v);
        faces = Json.Strings(d["faces"]);
        foreach (var kv in Json.Map(d["items"])) if (kv.Key != "start") Items[kv.Key] = new List<string>(Json.Strings(kv.Value));
        if (d.ContainsKey("outfits")) foreach (var o in Json.List(d["outfits"])) { var one = Json.Map(o); outfits[(string)one["name"]] = Texts(one["wear"]); }
        Dress(Texts(Json.Map(d["items"])["start"]));
    }

    static Dictionary<string, string> Texts(object o) { var r = new Dictionary<string, string>(); foreach (var kv in Json.Map(o)) r[kv.Key] = (string)kv.Value; return r; }
    void Dress(Dictionary<string, string> wear) { Wear.Clear(); foreach (var kv in wear) Wear[kv.Key] = kv.Value; }

    // Puts a piece on: PutOn("weapon", "weapon3"). One that this character does not have is refused.
    public bool PutOn(string slot, string item) {
        if (!Items.TryGetValue(slot, out var list) || !list.Contains(item)) return false;
        Wear[slot] = item;
        return true;
    }
    public void TakeOff(string slot) => Wear.Remove(slot);
    // Changes into a saved outfit.
    public bool PutOnOutfit(string name) {
        if (!outfits.TryGetValue(name, out var wear)) return false;
        Dress(wear);
        return true;
    }

    static Track ReadTrack(Dictionary<string, object> t, byte[] bin, int frames) {
        var r = new Track { Rows = Json.Int(t["rows"]), Cols = Json.Int(t["cols"]), Uv = Json.Floats(t["uv"]) };
        r.Corners = r.Rows * r.Cols;
        var raw = new byte[Json.Int(t["raw"])];
        // two bytes of zlib header, which DeflateStream does not read
        using (var z = new DeflateStream(new MemoryStream(bin, Json.Int(t["at"]) + 2, Json.Int(t["bytes"]) - 2), CompressionMode.Decompress)) {
            int k = 0, q;
            while (k < raw.Length && (q = z.Read(raw, k, raw.Length - k)) > 0) k += q;
        }
        r.Positions = new Vector3[frames * r.Corners];
        for (int i = 0; i < r.Positions.Length; i++) {
            var v = new Vector3(BitConverter.ToInt16(raw, i * 4) / Steps, -BitConverter.ToInt16(raw, i * 4 + 2) / Steps);
            r.Positions[i] = i < r.Corners ? v : r.Positions[i - r.Corners] + v;
        }
        var tint = Json.Floats(t["tint"]);
        r.Colours = new Color[r.Corners];
        for (int i = 0; i < r.Corners; i++) r.Colours[i] = new Color(tint[0], tint[1], tint[2]);
        var ix = new List<int>();
        for (int y = 0; y < r.Rows - 1; y++) for (int x = 0; x < r.Cols - 1; x++) { int a = y * r.Cols + x; ix.AddRange(new[] { a, a + 1, a + r.Cols + 1, a, a + r.Cols + 1, a + r.Cols }); }
        r.Triangles = ix.ToArray();
        if (t.ContainsKey("uvs")) { r.Uvs = new Dictionary<string, float[]>(); foreach (var e in Json.Map(t["uvs"])) if (e.Value != null) r.Uvs[e.Key] = Json.Floats(e.Value); }
        if (t.ContainsKey("off")) { r.Off = new Dictionary<string, Vector2>(); foreach (var e in Json.Map(t["off"])) { var o = Json.Floats(e.Value); r.Off[e.Key] = new Vector2(o[0], o[1]); } }
        return r;
    }

    // How what is in the hands is used: spear, staff, bow, launcher, shield, fists. Empty for a weapon that is swung, or in a package that has nothing else.
    public string Type => types == null ? "" : Worn("weapon") == "" ? "fists" : types.TryGetValue(Worn("weapon"), out var t) ? t : Worn("shield") != "" ? "shield" : "";
    // The motion that is really played with what is in the hands: with a bow, attack is the motion bow/attack.
    string Key { get { var own = Type + "/" + Motion; return clips.ContainsKey(own) ? own : Motion; } }

    // What the weapon shoots, for a game that flies it. The texture points up, Tail is its rear end on it in pixels from its lower left corner, Size
    // units of this object for one of its pixels; it leaves from From towards Direction, in this object's space. False for what is not shot.
    public struct Missiles { public Texture2D Texture; public Vector2 Tail; public float Size; public Vector3 From, Direction; }
    public bool Shot(out Missiles shot) {
        shot = default;
        if (!shots.TryGetValue(Worn("weapon"), out var s) || !pictures.TryGetValue(s.Picture, out var p)) return false;
        var b = Blade();
        // a staff is held upright and what it fires flies forward
        shot = new Missiles { Texture = p.Texture, Tail = new Vector2(s.Tail.x - p.X, p.H - (s.Tail.y - p.Y)), Size = s.Size, From = Type == "bow" ? b[0] : b[1], Direction = Type == "staff" ? Vector3.right : (b[1] - b[0]).normalized };
        return true;
    }

    // Starts a motion from its beginning; with restart off, one that is playing goes on.
    public bool Play(string motion, bool restart = true) {
        if (!clips.ContainsKey(motion)) return false;
        if (motion == Motion && !restart) return true;
        Motion = motion;
        Seconds = 0;
        toldHit = toldEnd = false;
        from = new Dictionary<string, Vector3[]>(last);
        since = 0;
        return true;
    }

    void Update() {
        if (!Running || order == null) return;
        Seconds += Time.deltaTime * Speed;
        since += Time.deltaTime;
        var c = clips[Key];
        if (Key != played) {
            // other hands: what is carried changes at once, so nothing is blended
            if (played.Substring(played.LastIndexOf('/') + 1) == Motion && Seconds > Time.deltaTime) { since = 9; if (!c.Loop) Seconds = 0; }
            played = Key;
        }
        if (c.Loop && Seconds >= c.Seconds) { Seconds %= c.Seconds; toldHit = false; }
        if (!toldHit && c.Hit >= 0 && Seconds >= c.Hit) { toldHit = true; Hit?.Invoke(); }
        if (!toldEnd && !c.Loop && Seconds >= c.Seconds) { toldEnd = true; Finished?.Invoke(Motion); }
        Show();
    }

    // One moment of a motion, without blending.
    public void Pose(string motion, float seconds) { Motion = motion; Seconds = seconds; since = 9; Show(); }
    public void Hide() { foreach (var r in pool) r.enabled = false; }

    // Grip and tip of the weapon now, in this object's space: for hit boxes and trails. Null without a weapon.
    public Vector3[] Blade() {
        var weapon = Worn("weapon");
        if (weapon == "") return null;
        Place(out int a, out _, out _);
        var b = blades[weapon];
        int i = (clips[Key].From + a) * 4;
        return new[] { new Vector3(b[i], -b[i + 1]) / Steps, new Vector3(b[i + 2], -b[i + 3]) / Steps };
    }

    string Worn(string group) => Wear.TryGetValue(group, out var v) ? v : "";

    void Place(out int a, out int b, out float k) {
        var c = clips[Key];
        float u = c.Loop ? Seconds % c.Seconds / c.Seconds * c.Count : Mathf.Min(Seconds / c.Seconds, 1) * (c.Count - 1);
        a = Mathf.Min((int)u, c.Count - 1);
        b = c.Loop ? (a + 1) % c.Count : Mathf.Min(a + 1, c.Count - 1);
        k = u - a;
    }

    void Show() {
        Place(out int a, out int b, out float k);
        int first = clips[Key].From;
        string hands = Type;
        bool shield = Worn("shield") != "" && Array.IndexOf(twoHanded, hands) < 0, ahead = Array.IndexOf(farHand, hands) >= 0;
        string expression = faces[face[first + a]], number = Worn("weapon").Replace("weapon", "");
        var done = new Dictionary<string, Vector3[]>();
        used = 0;
        foreach (var slot in orders[order[first + a]]) {
            string part = slot.TrimEnd('+'), track = part, picture = part, look = "";
            if (slot == "hair" && Worn("cape") != "") continue;
            if (slot == "shield" && !shield) continue;
            if (slot == "weapon" && ahead || slot == "staff" && hands != "staff" || (slot == "bow" || slot == "string" || slot == "shot") && hands != "bow") continue;
            bool far = part == "armF" || part == "creaseF";
            if (far) {
                track = part + (shield ? "" : number);
                // whatever it holds, the far hand is the near one's fist
                if (hands != "") picture = part.Substring(0, part.Length - 1) + "N";
            }
            if (slot == "head") {
                look = expression;
                track = Worn("head") != "" ? "head" : "bare";
                picture = (track == "head" ? "face/" : "head/") + expression;
            } else if (Group.TryGetValue(slot, out var group)) {
                var item = Worn(group);
                if (item == "") continue;
                if (slot == "string" || slot == "shot") { track = slot + number; picture = track; }
                else if (slot == "weapon" || slot == "bow" || slot == "staff" || slot == "shield" || slot == "cape") { track = item; picture = item; }
                else { picture = item + "/" + (far ? picture : part); if (slot == "head+") look = expression; }
            }
            if (!tracks.TryGetValue(track, out var t)) continue;
            if (!done.TryGetValue(track, out var v)) done[track] = v = Corners(track, t, first + a, first + b, k);
            if (pictures.TryGetValue(picture, out var shown)) Draw(shown, v, Places(track, t, picture, look, slot == "head+"), t);
        }
        for (int i = used; i < pool.Count; i++) pool[i].enabled = false;
    }

    Vector3[] Corners(string name, Track t, int a, int b, float k) {
        var v = new Vector3[t.Corners];
        for (int i = 0; i < v.Length; i++) v[i] = t.Positions[a * t.Corners + i];
        Vector3[] next = new Vector3[v.Length];
        System.Array.Copy(t.Positions, b * t.Corners, next, 0, next.Length);
        v = Mix(name, t, v, next, k);
        if (since < Blend && from.TryGetValue(name, out var before)) v = Mix(name, t, before, v, Mathf.SmoothStep(0, 1, since / Blend));
        return last[name] = v;
    }

    // The moment between two. Corners go straight from one to the other, but a weapon is stiff: it turns about the hand and keeps its shape.
    Vector3[] Mix(string name, Track t, Vector3[] a, Vector3[] b, float k) {
        var r = new Vector3[a.Length];
        bool inHand = blades.TryGetValue(name, out var blade) && t.Rows > 1;
        if (!inHand && (t.Rows != 2 || t.Cols != 2)) {
            for (int i = 0; i < r.Length; i++) r[i] = Vector3.Lerp(a[i], b[i], k);
            return r;
        }
        int end = (t.Rows - 1) * t.Cols;
        float Turned(Vector3 from, Vector3 to) => Mathf.Atan2(to.y - from.y, to.x - from.x) * Mathf.Rad2Deg;
        Vector3 Rotated(Vector3 p, float degrees) => Quaternion.Euler(0, 0, degrees) * p;
        // where on the weapon the hand is, seen along its first column of corners; whatever else is stiff turns about its middle
        var about = inHand ? new Vector3(blade[0], -blade[1]) / Steps : (t.Positions[0] + t.Positions[3]) / 2;
        var held = Rotated(about - t.Positions[0], -Turned(t.Positions[0], t.Positions[end]));
        float one = Turned(a[0], a[end]), two = Turned(b[0], b[end]), turn = Mathf.DeltaAngle(one, two) * k;
        Vector3 hand = a[0] + Rotated(held, one), at = Vector3.Lerp(hand, b[0] + Rotated(held, two), k);
        for (int i = 0; i < r.Length; i++) r[i] = at + Rotated(a[i] - hand, turn);
        return r;
    }

    // Where the corners lie on a cropped picture. Every expression has its own place in its drawing; helmets follow the calm one.
    Vector2[] Places(string name, Track t, string picture, string look, bool helmet) {
        string key = name + "|" + picture + "|" + look + (helmet ? "+" : "");
        if (places.TryGetValue(key, out var known)) return known;
        var p = pictures[picture];
        var uv = look != "" && t.Uvs != null && t.Uvs.TryGetValue(look, out var own) ? own : t.Uv;
        var shift = new Vector2(p.X, p.Y);
        if (helmet && t.Off != null) shift += t.Off[look];
        var r = new Vector2[uv.Length / 2];
        for (int i = 0; i < r.Length; i++) r[i] = new Vector2((uv[i * 2] - shift.x) / p.W, 1 - (uv[i * 2 + 1] - shift.y) / p.H);
        return places[key] = r;
    }

    void Draw(Picture p, Vector3[] v, Vector2[] uv, Track t) {
        if (shader == null) shader = Shader.Find("Sprites/Default");
        if (used == pool.Count) {
            var g = new GameObject("part");
            g.transform.SetParent(transform, false);
            g.AddComponent<MeshFilter>().sharedMesh = new Mesh();
            var fresh = g.AddComponent<MeshRenderer>();
            fresh.sharedMaterial = new Material(shader);
            pool.Add(fresh);
        }
        var r = pool[used];
        r.enabled = true;
        r.sortingOrder = used++;
        r.sharedMaterial.mainTexture = p.Texture;
        var m = r.GetComponent<MeshFilter>().sharedMesh;
        m.Clear();
        m.vertices = v;
        m.uv = uv;
        m.colors = t.Colours;
        m.triangles = t.Triangles;
        m.RecalculateBounds();
    }

    static class Json {
        static string s;
        static int i;
        public static object Parse(string text) { s = text; i = 0; return Value(); }
        public static Dictionary<string, object> Map(object o) => (Dictionary<string, object>)o;
        public static List<object> List(object o) => (List<object>)o;
        public static int Int(object o) => (int)Math.Round((double)o);
        public static float Float(object o) => (float)(double)o;
        public static float[] Floats(object o) { var l = List(o); var r = new float[l.Count]; for (int k = 0; k < r.Length; k++) r[k] = Float(l[k]); return r; }
        public static string[] Strings(object o) { var l = List(o); var r = new string[l.Count]; for (int k = 0; k < r.Length; k++) r[k] = (string)l[k]; return r; }
        static void Space() { while (char.IsWhiteSpace(s[i])) i++; }
        static object Value() {
            Space();
            char c = s[i];
            if (c == '{') { i++; var o = new Dictionary<string, object>(); Space(); if (s[i] == '}') { i++; return o; } while (true) { Space(); var k = Text(); Space(); i++; o[k] = Value(); Space(); if (s[i++] == '}') return o; } }
            if (c == '[') { i++; var a = new List<object>(); Space(); if (s[i] == ']') { i++; return a; } while (true) { a.Add(Value()); Space(); if (s[i++] == ']') return a; } }
            if (c == '"') return Text();
            if (c == 't') { i += 4; return true; }
            if (c == 'f') { i += 5; return false; }
            if (c == 'n') { i += 4; return null; }
            int b = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            return double.Parse(s.Substring(b, i - b), CultureInfo.InvariantCulture);
        }
        static string Text() { var q = new StringBuilder(); i++; while (s[i] != '"') { if (s[i] == '\\') i++; q.Append(s[i++]); } i++; return q.ToString(); }
    }
}
