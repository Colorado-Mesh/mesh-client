using System.Reflection;
using System.Text.Json;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Text;
using Windows.ApplicationModel;

internal static class Program
{
    private static readonly object Output = new();
    private static CancellationTokenSource? active;
    private static void Emit(object value) { lock (Output) Console.WriteLine(JsonSerializer.Serialize(value)); }
    private static string Metadata(string key) => Assembly.GetExecutingAssembly().GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == key)?.Value ?? "";
    private static bool Available()
    {
        // OS-specific: Phi Silica needs a maintainer-issued LAF token and a supported
        // package identity with systemAIModels. NSIS installations may be unavailable.
        try
        {
            var token = Metadata("AiLafToken");
            var attestation = Metadata("AiLafAttestation");
            if (string.IsNullOrEmpty(token) || string.IsNullOrEmpty(attestation)) return false;
            var access = LimitedAccessFeatures.TryUnlockFeature("com.microsoft.windows.ai.languagemodel", token, attestation);
            if (access.Status is not (LimitedAccessFeatureStatus.Available or LimitedAccessFeatureStatus.AvailableWithoutToken)) return false;
            return LanguageModel.GetReadyState() == AIFeatureReadyState.Ready;
        }
        catch { return false; } // Availability failures never expose framework/user data.
    }
    public static async Task Main()
    {
        Emit(new { type = "ready" });
        while (await Console.In.ReadLineAsync() is { } line)
        {
            if (line.Length > 128 * 1024) continue;
            try
            {
                using var json = JsonDocument.Parse(line);
                var root = json.RootElement;
                var type = root.GetProperty("type").GetString();
                if (type == "probe") { Emit(new { type = "probe", available = Available(), modelLabel = "Phi Silica" }); continue; }
                if (type == "cancel") { active?.Cancel(); continue; }
                if (type != "generate") continue;
                var id = root.GetProperty("requestId").GetString() ?? "";
                if (active != null || !Available()) { Emit(new { type = "error", requestId = id, reason = "engineNotReady" }); continue; }
                var prompt = root.GetProperty("system").GetString() + "\n\n" + root.GetProperty("user").GetString();
                var cancellation = new CancellationTokenSource(); active = cancellation;
                _ = Generate(id, prompt, cancellation);
            }
            catch { Emit(new { type = "error", reason = "invalidRequest" }); }
        }
        active?.Cancel();
    }
    private static async Task Generate(string id, string prompt, CancellationTokenSource cancellation)
    {
        string? failure = null;
        try
        {
            using var model = await LanguageModel.CreateAsync();
            cancellation.Token.ThrowIfCancellationRequested();
            var operation = model.GenerateResponseAsync(prompt, new LanguageModelOptions { Temperature = 0.2f, TopP = 0.9f });
            using var registration = cancellation.Token.Register(operation.Cancel);
            var length = 0;
            operation.Progress = (_, delta) =>
            {
                if (cancellation.IsCancellationRequested) return;
                // API has no max-tokens parameter. Bound text and stop generation promptly.
                var room = Math.Max(0, 1000 - length);
                var text = delta.Length > room ? delta[..room] : delta;
                length += text.Length;
                if (text.Length > 0) Emit(new { type = "delta", requestId = id, text });
                if (length >= 1000) operation.Cancel();
            };
            try { var result = await operation; if (result.Status != LanguageModelResponseStatus.Complete) throw new InvalidOperationException("Generation unavailable"); }
            catch (OperationCanceledException) when (length >= 1000 && !cancellation.IsCancellationRequested) { }
            cancellation.Token.ThrowIfCancellationRequested();
        }
        catch { failure = cancellation.IsCancellationRequested ? "cancelled" : "error"; }
        finally { if (ReferenceEquals(active, cancellation)) active = null; cancellation.Dispose(); }
        // The next pass may arrive as soon as the terminal event is written.
        if (failure == null) Emit(new { type = "done", requestId = id });
        else Emit(new { type = "error", requestId = id, reason = failure });
    }
}
