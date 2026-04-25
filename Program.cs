using System.ComponentModel;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Msagl.Core.Geometry;
using Microsoft.Msagl.Core.Geometry.Curves;
using Microsoft.Msagl.Core.Routing;
using Microsoft.Msagl.Drawing;
using Microsoft.Msagl.Layout.Layered;
using Microsoft.Msagl.Layout.MDS;
using Microsoft.Msagl.Miscellaneous;
using ModelContextProtocol;
using ModelContextProtocol.Server;

var exitCode = McpServerMode.IsRequested(args)
    ? await McpServerMode.RunAsync(args)
    : await ProgramEntry.RunAsync(args);
return exitCode;

static class McpServerMode
{
    public static bool IsRequested(string[] args) =>
        args.Any(arg => string.Equals(arg, "--mcp", StringComparison.OrdinalIgnoreCase));

    public static async Task<int> RunAsync(string[] args)
    {
        var filteredArgs = args
            .Where(arg => !string.Equals(arg, "--mcp", StringComparison.OrdinalIgnoreCase))
            .ToArray();

        var builder = Host.CreateApplicationBuilder(filteredArgs);
        builder.Logging.ClearProviders();
        builder.Logging.AddConsole(consoleLogOptions =>
        {
            consoleLogOptions.LogToStandardErrorThreshold = LogLevel.Trace;
        });

        builder.Services
            .AddMcpServer()
            .WithStdioServerTransport()
            .WithTools<EpiphanyGraphMcpTools>();

        await builder.Build().RunAsync();
        return 0;
    }
}

static class ProgramEntry
{
    public static async Task<int> RunAsync(string[] args)
    {
        CliOptions options;
        try
        {
            options = CliOptions.Parse(args);
        }
        catch (ArgumentException ex)
        {
            Console.Error.WriteLine(ex.Message);
            Console.Error.WriteLine();
            PrintUsage();
            return 1;
        }

        if (options.ShowHelp)
        {
            PrintUsage();
            return 0;
        }

        try
        {
            var result = await GraphGenerator.GenerateAsync(options.Request!, CancellationToken.None);
            Console.WriteLine($"Wrote manifest: {result.ManifestPath}");
            Console.WriteLine($"Wrote cross-links: {result.CrossLinksPath}");
            Console.WriteLine($"Wrote warnings: {result.WarningsPath}");
            Console.WriteLine($"Seeds: {string.Join(", ", result.SeedNoteIds)}");
            Console.WriteLine($"Graphs: {result.Graphs.Count}, Notes: {result.TotalNoteCount}, Edges: {result.TotalEdgeCount}, Warnings: {result.Warnings.Count}");

            foreach (var graph in result.Graphs.OrderBy(graph => graph.Key, StringComparer.OrdinalIgnoreCase))
            {
                Console.WriteLine($"[{graph.Key}] {graph.NodeCount} nodes, {graph.EdgeCount} edges");
                Console.WriteLine($"  SVG: {graph.SvgPath}");
                Console.WriteLine($"  JSON: {graph.JsonPath}");
            }

            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            return 1;
        }
    }

    private static void PrintUsage()
    {
        Console.WriteLine("""
Usage:
  epiphanygraph --vault-root <path> [--output-dir <path>] [--entry-note <name>] [--layout sugiyama|mds] [--renderer msagl|rich] [--include-unreachable]
  epiphanygraph --mcp

Examples:
  epiphanygraph --vault-root "E:\Projects\Aetheria-Economy\Aetheria\Source Tree Map" --entry-note "Source Tree Map"
  epiphanygraph --vault-root "E:\Projects\Aetheria-Economy\Aetheria\Source Tree Map" --entry-note "Source Tree Map" --layout mds --renderer rich --output-dir ".\out\mds"
  epiphanygraph --mcp

Outputs:
  manifest.json       overall run summary plus partition outputs
  source-tree.svg     primary rendered SVG for source-tree notes
  source-tree.msagl.svg raw MSAGL SVG for source-tree notes
  source-tree.rich.svg  custom SVG renderer output for source-tree notes
  source-tree.json    node and edge positions plus metadata for the source-tree partition
  control-flow.svg    primary rendered SVG for control-flow notes
  control-flow.msagl.svg raw MSAGL SVG for control-flow notes
  control-flow.rich.svg  custom SVG renderer output for control-flow notes
  control-flow.json   node and edge positions plus metadata for the control-flow partition
  cross-links.json    links that cross between graph families
  warnings.txt        unresolved or ambiguous link warnings

Modes:
  --mcp           expose the generator as an MCP stdio server
""");
    }
}

sealed record CliOptions(GraphGenerationRequest? Request, bool ShowHelp)
{
    public static CliOptions Parse(string[] args)
    {
        string? vaultRoot = null;
        string? outputDirectory = null;
        string? entryNote = null;
        var layoutMode = LayoutMode.Sugiyama;
        var rendererMode = RendererMode.Msagl;
        var includeUnreachable = false;
        var showHelp = false;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--help":
                case "-h":
                    showHelp = true;
                    break;
                case "--vault-root":
                    vaultRoot = ReadValue(args, ref i, "--vault-root");
                    break;
                case "--output-dir":
                    outputDirectory = ReadValue(args, ref i, "--output-dir");
                    break;
                case "--entry-note":
                    entryNote = ReadValue(args, ref i, "--entry-note");
                    break;
                case "--layout":
                {
                    var raw = ReadValue(args, ref i, "--layout");
                    layoutMode = LayoutModeExtensions.Parse(raw);
                    break;
                }
                case "--renderer":
                {
                    var raw = ReadValue(args, ref i, "--renderer");
                    rendererMode = RendererModeExtensions.Parse(raw);
                    break;
                }
                case "--include-unreachable":
                    includeUnreachable = true;
                    break;
                default:
                    throw new ArgumentException($"Unknown argument '{args[i]}'.");
            }
        }

        if (showHelp)
        {
            return new CliOptions(null, true);
        }

        return new CliOptions(
            GraphGenerationRequest.Normalize(vaultRoot, outputDirectory, entryNote, layoutMode, rendererMode, includeUnreachable),
            false);
    }

    private static string ReadValue(string[] args, ref int index, string option)
    {
        if (index + 1 >= args.Length)
        {
            throw new ArgumentException($"Missing value for '{option}'.");
        }

        index++;
        return args[index];
    }
}

sealed record GraphGenerationRequest(
    string VaultRoot,
    string OutputDirectory,
    string? EntryNote,
    LayoutMode LayoutMode,
    RendererMode RendererMode,
    bool IncludeUnreachable)
{
    public string GraphTitle =>
        string.IsNullOrWhiteSpace(EntryNote)
            ? $"Obsidian Graph - {Path.GetFileName(VaultRoot)}"
            : $"Obsidian Graph - {EntryNote}";

    public static GraphGenerationRequest Normalize(
        string? vaultRoot,
        string? outputDirectory,
        string? entryNote,
        LayoutMode layoutMode,
        RendererMode rendererMode,
        bool includeUnreachable)
    {
        if (string.IsNullOrWhiteSpace(vaultRoot))
        {
            throw new ArgumentException("Missing required vault root.");
        }

        var normalizedVaultRoot = Path.GetFullPath(vaultRoot);
        if (!Directory.Exists(normalizedVaultRoot))
        {
            throw new ArgumentException($"Vault root does not exist: {normalizedVaultRoot}");
        }

        var normalizedOutput = string.IsNullOrWhiteSpace(outputDirectory)
            ? Path.Combine(Environment.CurrentDirectory, "out")
            : Path.GetFullPath(outputDirectory);

        var normalizedEntryNote = string.IsNullOrWhiteSpace(entryNote) ? null : entryNote.Trim();

        return new GraphGenerationRequest(
            normalizedVaultRoot,
            normalizedOutput,
            normalizedEntryNote,
            layoutMode,
            rendererMode,
            includeUnreachable);
    }
}

static class GraphGenerator
{
    public static async Task<GraphGenerationResult> GenerateAsync(
        GraphGenerationRequest request,
        CancellationToken cancellationToken)
    {
        var model = VaultGraphModel.Load(request.VaultRoot, request.EntryNote, request.IncludeUnreachable);

        var outputDirectory = Directory.CreateDirectory(request.OutputDirectory);
        var manifestPath = Path.Combine(outputDirectory.FullName, "manifest.json");
        var crossLinksPath = Path.Combine(outputDirectory.FullName, "cross-links.json");
        var warningsPath = Path.Combine(outputDirectory.FullName, "warnings.txt");

        var partitionResults = new List<GraphPartitionResult>();
        foreach (var partition in model.Partitions)
        {
            var drawingGraph = GraphLayoutBuilder.Build(partition, model, request);
            var slug = partition.Key;
            var svgPath = Path.Combine(outputDirectory.FullName, $"{slug}.svg");
            var msaglSvgPath = Path.Combine(outputDirectory.FullName, $"{slug}.msagl.svg");
            var richSvgPath = Path.Combine(outputDirectory.FullName, $"{slug}.rich.svg");
            var jsonPath = Path.Combine(outputDirectory.FullName, $"{slug}.json");

            await using (var svgStream = File.Create(msaglSvgPath))
            {
                var writer = new SvgGraphWriter(svgStream, drawingGraph)
                {
                    Precision = 2,
                };
                writer.Write();
            }

            var report = LayoutReport.From(partition, model, drawingGraph, request);
            await File.WriteAllTextAsync(
                jsonPath,
                JsonSerializer.Serialize(report, JsonOptions),
                cancellationToken);

            await File.WriteAllTextAsync(
                richSvgPath,
                RichSvgRenderer.Render(report, drawingGraph),
                cancellationToken);

            var preferredSvgPath = request.RendererMode switch
            {
                RendererMode.Rich => richSvgPath,
                _ => msaglSvgPath,
            };

            File.Copy(preferredSvgPath, svgPath, overwrite: true);

            partitionResults.Add(new GraphPartitionResult
            {
                Key = partition.Key,
                Title = partition.Title,
                SvgPath = svgPath,
                MsaglSvgPath = msaglSvgPath,
                RichSvgPath = richSvgPath,
                JsonPath = jsonPath,
                RendererMode = request.RendererMode.ToApiValue(),
                NodeCount = report.NodeCount,
                EdgeCount = report.EdgeCount,
            });
        }

        await File.WriteAllTextAsync(
            crossLinksPath,
            JsonSerializer.Serialize(CrossFamilyLinkReport.From(model), JsonOptions),
            cancellationToken);

        await File.WriteAllLinesAsync(warningsPath, model.Warnings, cancellationToken);

        var result = new GraphGenerationResult
        {
            GeneratedAtUtc = DateTime.UtcNow.ToString("O"),
            VaultRoot = request.VaultRoot,
            EntryNoteId = model.EntryNoteId,
            SeedNoteIds = model.SeedNoteIds,
            OutputDirectory = outputDirectory.FullName,
            ManifestPath = manifestPath,
            CrossLinksPath = crossLinksPath,
            WarningsPath = warningsPath,
            LayoutMode = request.LayoutMode.ToApiValue(),
            RendererMode = request.RendererMode.ToApiValue(),
            TotalNoteCount = model.IncludedNoteIds.Count,
            TotalEdgeCount = model.AllEdges.Count,
            Graphs = partitionResults,
            Warnings = model.Warnings,
        };

        await File.WriteAllTextAsync(
            manifestPath,
            JsonSerializer.Serialize(result, JsonOptions),
            cancellationToken);

        return result;
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
    };
}

sealed class GraphGenerationResult
{
    public required string GeneratedAtUtc { get; init; }
    public required string VaultRoot { get; init; }
    public required string? EntryNoteId { get; init; }
    public required IReadOnlyList<string> SeedNoteIds { get; init; }
    public required string OutputDirectory { get; init; }
    public required string ManifestPath { get; init; }
    public required string CrossLinksPath { get; init; }
    public required string WarningsPath { get; init; }
    public required string LayoutMode { get; init; }
    public required string RendererMode { get; init; }
    public required int TotalNoteCount { get; init; }
    public required int TotalEdgeCount { get; init; }
    public required IReadOnlyList<GraphPartitionResult> Graphs { get; init; }
    public required IReadOnlyList<string> Warnings { get; init; }
}

static class LayoutModeExtensions
{
    public static LayoutMode Parse(string raw)
    {
        return raw.Trim().ToLowerInvariant() switch
        {
            "sugiyama" => LayoutMode.Sugiyama,
            "mds" => LayoutMode.Mds,
            _ => throw new ArgumentException($"Unsupported layout mode '{raw}'. Use 'sugiyama' or 'mds'."),
        };
    }

    public static string ToApiValue(this LayoutMode layoutMode) =>
        layoutMode switch
        {
            LayoutMode.Sugiyama => "sugiyama",
            LayoutMode.Mds => "mds",
            _ => throw new ArgumentOutOfRangeException(nameof(layoutMode), layoutMode, null),
        };
}

static class RendererModeExtensions
{
    public static RendererMode Parse(string raw)
    {
        return raw.Trim().ToLowerInvariant() switch
        {
            "msagl" => RendererMode.Msagl,
            "rich" => RendererMode.Rich,
            _ => throw new ArgumentException($"Unsupported renderer mode '{raw}'. Use 'msagl' or 'rich'."),
        };
    }

    public static string ToApiValue(this RendererMode rendererMode) =>
        rendererMode switch
        {
            RendererMode.Msagl => "msagl",
            RendererMode.Rich => "rich",
            _ => throw new ArgumentOutOfRangeException(nameof(rendererMode), rendererMode, null),
        };
}

[McpServerToolType]
sealed class EpiphanyGraphMcpTools
{
    [McpServerTool(
        Name = "generate_obsidian_graph_layout",
        Title = "Generate Obsidian Graph Layout",
        UseStructuredContent = true,
        Destructive = false,
        Idempotent = true,
        OpenWorld = false,
        ReadOnly = false)]
    [Description("Scan an Obsidian vault subtree, resolve note links, split the note set into source-tree and control-flow graph families, run MSAGL layout for each partition, and write manifest.json, partition SVG/JSON files, cross-links.json, and warnings.txt.")]
    public static async Task<GraphGenerationResult> GenerateObsidianGraphLayout(
        [Description("Path to the Obsidian vault folder that contains markdown notes.")] string vaultRoot,
        [Description("Optional entry note name or relative note path. When set, only reachable notes are kept unless includeUnreachable is true.")] string? entryNote = null,
        [Description("Optional output directory for manifest.json, partition SVG/JSON files, cross-links.json, and warnings.txt. Defaults to ./out relative to the server process working directory.")] string? outputDir = null,
        [Description("Layout algorithm to use. Choose 'sugiyama' for layered hierarchies or 'mds' for freer spread-out graphs.")] string layout = "sugiyama",
        [Description("Renderer to use for the primary partition SVG. Choose 'msagl' for the raw stock output or 'rich' for the custom readability-focused SVG.")] string renderer = "msagl",
        [Description("When true and entryNote is set, keep notes that are not reachable from the entry note.")] bool includeUnreachable = false,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var request = GraphGenerationRequest.Normalize(
                vaultRoot,
                outputDir,
                entryNote,
                LayoutModeExtensions.Parse(layout),
                RendererModeExtensions.Parse(renderer),
                includeUnreachable);

            return await GraphGenerator.GenerateAsync(request, cancellationToken);
        }
        catch (ArgumentException ex)
        {
            throw new McpException(ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            throw new McpException(ex.Message);
        }
    }
}

enum LayoutMode
{
    Sugiyama,
    Mds,
}

enum RendererMode
{
    Msagl,
    Rich,
}

sealed class VaultGraphModel
{
    public required string VaultRoot { get; init; }
    public required string? EntryNoteId { get; init; }
    public required IReadOnlyList<string> SeedNoteIds { get; init; }
    public required IReadOnlyDictionary<string, NoteRecord> NotesById { get; init; }
    public required IReadOnlyList<EdgeRecord> AllEdges { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlySet<GraphFamily>> FamiliesByNoteId { get; init; }
    public required IReadOnlyDictionary<string, int> DepthById { get; init; }
    public required IReadOnlyCollection<string> IncludedNoteIds { get; init; }
    public required IReadOnlyList<GraphPartitionModel> Partitions { get; init; }
    public required IReadOnlyList<EdgeRecord> CrossFamilyEdges { get; init; }
    public required IReadOnlyList<string> Warnings { get; init; }

    public static VaultGraphModel Load(string vaultRoot, string? entryNote, bool includeUnreachable)
    {
        var warnings = new List<string>();
        var noteFiles = Directory
            .EnumerateFiles(vaultRoot, "*.md", SearchOption.AllDirectories)
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (noteFiles.Length == 0)
        {
            throw new InvalidOperationException($"No markdown notes were found under '{vaultRoot}'.");
        }

        var notes = noteFiles
            .Select(path => NoteRecord.FromFile(vaultRoot, path))
            .ToDictionary(note => note.Id, note => note, StringComparer.OrdinalIgnoreCase);
        var familiesByNoteId = notes.Values.ToDictionary(
            note => note.Id,
            NoteFamilyClassifier.Classify,
            StringComparer.OrdinalIgnoreCase);

        var byRelativeStem = notes.Values.ToDictionary(note => note.RelativeStem, note => note, StringComparer.OrdinalIgnoreCase);
        var byBaseName = notes.Values
            .GroupBy(note => note.BaseName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.OrdinalIgnoreCase);

        var edgeSet = new HashSet<(string source, string target)>(StringTupleComparer.OrdinalIgnoreCase);
        foreach (var note in notes.Values)
        {
            foreach (var targetId in ExtractTargets(note, notes, byRelativeStem, byBaseName, warnings))
            {
                if (!string.Equals(note.Id, targetId, StringComparison.OrdinalIgnoreCase))
                {
                    edgeSet.Add((note.Id, targetId));
                }
            }
        }

        var edges = edgeSet
            .OrderBy(edge => edge.source, StringComparer.OrdinalIgnoreCase)
            .ThenBy(edge => edge.target, StringComparer.OrdinalIgnoreCase)
            .Select(edge => new EdgeRecord(edge.source, edge.target))
            .ToArray();

        var outgoing = BuildAdjacency(edges, source => source.SourceId, edge => edge.TargetId);
        var incoming = BuildAdjacency(edges, source => source.TargetId, edge => edge.SourceId);

        string? entryNoteId = null;
        if (!string.IsNullOrWhiteSpace(entryNote))
        {
            entryNoteId = ResolveEntryNote(entryNote, notes, byRelativeStem, byBaseName);
            if (entryNoteId is null)
            {
                throw new InvalidOperationException($"Could not resolve entry note '{entryNote}'.");
            }
        }

        var seedNoteIds = entryNoteId is null
            ? Array.Empty<string>()
            : ResolveSeedNotes(entryNoteId, notes, familiesByNoteId, byBaseName);

        var included = includeUnreachable || entryNoteId is null
            ? new HashSet<string>(notes.Keys, StringComparer.OrdinalIgnoreCase)
            : TraverseFromEntries(seedNoteIds, outgoing);

        var depths = entryNoteId is null
            ? notes.Keys.ToDictionary(id => id, _ => 0, StringComparer.OrdinalIgnoreCase)
            : CalculateDepths(seedNoteIds, outgoing, included);

        if (includeUnreachable && entryNoteId is not null)
        {
            foreach (var noteId in notes.Keys.Where(id => !depths.ContainsKey(id)))
            {
                depths[noteId] = -1;
            }
        }

        var filteredEdges = edges
            .Where(edge => included.Contains(edge.SourceId) && included.Contains(edge.TargetId))
            .ToArray();
        var crossFamilyEdges = filteredEdges
            .Where(edge => !ShareFamily(familiesByNoteId[edge.SourceId], familiesByNoteId[edge.TargetId]))
            .ToArray();

        var referencedOnlyIncoming = included
            .Where(id => entryNoteId is not null)
            .Where(id => !depths.ContainsKey(id))
            .ToArray();

        foreach (var orphan in referencedOnlyIncoming)
        {
            warnings.Add($"Unreachable from entry note: {notes[orphan].RelativePath}");
        }

        var partitions = BuildPartitions(notes, familiesByNoteId, filteredEdges, depths, included, entryNoteId);

        return new VaultGraphModel
        {
            VaultRoot = vaultRoot,
            EntryNoteId = entryNoteId,
            SeedNoteIds = seedNoteIds,
            NotesById = notes,
            AllEdges = filteredEdges,
            FamiliesByNoteId = familiesByNoteId,
            DepthById = depths,
            IncludedNoteIds = included,
            Partitions = partitions,
            CrossFamilyEdges = crossFamilyEdges,
            Warnings = warnings,
        };
    }

    private static IEnumerable<string> ExtractTargets(
        NoteRecord source,
        IReadOnlyDictionary<string, NoteRecord> notes,
        IReadOnlyDictionary<string, NoteRecord> byRelativeStem,
        IReadOnlyDictionary<string, NoteRecord[]> byBaseName,
        List<string> warnings)
    {
        var yielded = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (Match match in LinkPatterns.Wikilinks.Matches(source.Content))
        {
            var rawTarget = match.Groups[1].Value;
            if (TryResolveWikilinkTarget(source, rawTarget, byRelativeStem, byBaseName, out var resolved, out var warning) && resolved is not null)
            {
                if (yielded.Add(resolved.Id))
                {
                    yield return resolved.Id;
                }
            }
            else if (warning is not null)
            {
                warnings.Add(warning);
            }
        }

        foreach (Match match in LinkPatterns.MarkdownLinks.Matches(source.Content))
        {
            var rawTarget = match.Groups[1].Value;
            if (rawTarget.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                rawTarget.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
                rawTarget.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase) ||
                rawTarget.StartsWith("#", StringComparison.Ordinal))
            {
                continue;
            }

            var resolvedPath = Path.GetFullPath(Path.Combine(source.DirectoryPath, rawTarget));
            if (!resolvedPath.StartsWith(source.VaultRoot, StringComparison.OrdinalIgnoreCase) ||
                !resolvedPath.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var relativeStem = NormalizePathStem(Path.GetRelativePath(source.VaultRoot, resolvedPath));
            if (byRelativeStem.TryGetValue(relativeStem, out var resolved))
            {
                if (yielded.Add(resolved.Id))
                {
                    yield return resolved.Id;
                }
            }
            else
            {
                warnings.Add($"Unresolved markdown link in {source.RelativePath}: {rawTarget}");
            }
        }
    }

    private static bool TryResolveWikilinkTarget(
        NoteRecord source,
        string rawTarget,
        IReadOnlyDictionary<string, NoteRecord> byRelativeStem,
        IReadOnlyDictionary<string, NoteRecord[]> byBaseName,
        out NoteRecord? resolved,
        out string? warning)
    {
        warning = null;
        resolved = null;

        var normalized = NormalizePathStem(rawTarget);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return false;
        }

        if (normalized.Contains('/'))
        {
            if (byRelativeStem.TryGetValue(normalized, out resolved))
            {
                return true;
            }

            var suffixMatches = byRelativeStem
                .Where(pair => pair.Key.EndsWith(normalized, StringComparison.OrdinalIgnoreCase))
                .Select(pair => pair.Value)
                .DistinctBy(note => note.Id, StringComparer.OrdinalIgnoreCase)
                .ToArray();

            if (suffixMatches.Length == 1)
            {
                resolved = suffixMatches[0];
                return true;
            }

            warning = $"Unresolved wikilink in {source.RelativePath}: [[{rawTarget}]]";
            return false;
        }

        if (byBaseName.TryGetValue(normalized, out var baseMatches))
        {
            if (baseMatches.Length == 1)
            {
                resolved = baseMatches[0];
                return true;
            }

            warning =
                $"Ambiguous wikilink in {source.RelativePath}: [[{rawTarget}]] -> " +
                string.Join(", ", baseMatches.Select(match => match.RelativePath));
            return false;
        }

        warning = $"Unresolved wikilink in {source.RelativePath}: [[{rawTarget}]]";
        return false;
    }

    private static string? ResolveEntryNote(
        string entryNote,
        IReadOnlyDictionary<string, NoteRecord> notes,
        IReadOnlyDictionary<string, NoteRecord> byRelativeStem,
        IReadOnlyDictionary<string, NoteRecord[]> byBaseName)
    {
        var normalized = NormalizePathStem(entryNote);
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return null;
        }

        if (byRelativeStem.TryGetValue(normalized, out var direct))
        {
            return direct.Id;
        }

        return byBaseName.TryGetValue(normalized, out var candidates) && candidates.Length == 1
            ? candidates[0].Id
            : null;
    }

    private static Dictionary<string, HashSet<string>> BuildAdjacency(
        IEnumerable<EdgeRecord> edges,
        Func<EdgeRecord, string> keySelector,
        Func<EdgeRecord, string> valueSelector)
    {
        var adjacency = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var edge in edges)
        {
            var key = keySelector(edge);
            if (!adjacency.TryGetValue(key, out var values))
            {
                values = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                adjacency[key] = values;
            }

            values.Add(valueSelector(edge));
        }

        return adjacency;
    }

    private static IReadOnlyList<string> ResolveSeedNotes(
        string entryNoteId,
        IReadOnlyDictionary<string, NoteRecord> notes,
        IReadOnlyDictionary<string, IReadOnlySet<GraphFamily>> familiesByNoteId,
        IReadOnlyDictionary<string, NoteRecord[]> byBaseName)
    {
        var seeds = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { entryNoteId };
        var entryFamilies = familiesByNoteId[entryNoteId];
        var entryNote = notes[entryNoteId];

        // Only auto-include sibling family roots when the chosen entry note is one of the
        // explicit family maps. That keeps subtree runs narrow while still letting the top-level
        // source tree map pull in the separate control-flow map.
        if (!entryFamilies.Any(family => string.Equals(entryNote.BaseName, family.GetDefaultRootTitle(), StringComparison.OrdinalIgnoreCase)))
        {
            return seeds.OrderBy(id => id, StringComparer.OrdinalIgnoreCase).ToArray();
        }

        foreach (var family in Enum.GetValues<GraphFamily>())
        {
            if (entryFamilies.Contains(family))
            {
                continue;
            }

            var rootTitle = family.GetDefaultRootTitle();
            if (!byBaseName.TryGetValue(rootTitle, out var candidates))
            {
                continue;
            }

            var match = candidates.SingleOrDefault(candidate => familiesByNoteId[candidate.Id].Contains(family));
            if (match is not null)
            {
                seeds.Add(match.Id);
            }
        }

        return seeds.OrderBy(id => id, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static HashSet<string> TraverseFromEntries(
        IReadOnlyCollection<string> entryNoteIds,
        IReadOnlyDictionary<string, HashSet<string>> outgoing)
    {
        var visited = new HashSet<string>(entryNoteIds, StringComparer.OrdinalIgnoreCase);
        var queue = new Queue<string>();
        foreach (var entryNoteId in entryNoteIds)
        {
            queue.Enqueue(entryNoteId);
        }

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (!outgoing.TryGetValue(current, out var neighbors))
            {
                continue;
            }

            foreach (var neighbor in neighbors)
            {
                if (visited.Add(neighbor))
                {
                    queue.Enqueue(neighbor);
                }
            }
        }

        return visited;
    }

    private static Dictionary<string, int> CalculateDepths(
        IReadOnlyCollection<string> entryNoteIds,
        IReadOnlyDictionary<string, HashSet<string>> outgoing,
        IReadOnlyCollection<string> included)
    {
        var depths = entryNoteIds.ToDictionary(
            id => id,
            _ => 0,
            StringComparer.OrdinalIgnoreCase);

        var queue = new Queue<string>(entryNoteIds);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            var currentDepth = depths[current];
            if (!outgoing.TryGetValue(current, out var neighbors))
            {
                continue;
            }

            foreach (var neighbor in neighbors.Where(included.Contains))
            {
                if (depths.TryAdd(neighbor, currentDepth + 1))
                {
                    queue.Enqueue(neighbor);
                }
            }
        }

        return depths;
    }

    private static string NormalizePathStem(string raw)
    {
        var normalized = raw
            .Replace('\\', '/')
            .Trim();

        if (normalized.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
        {
            normalized = normalized[..^3];
        }

        normalized = normalized.TrimStart('/');
        return normalized;
    }

    private static IReadOnlyList<GraphPartitionModel> BuildPartitions(
        IReadOnlyDictionary<string, NoteRecord> notes,
        IReadOnlyDictionary<string, IReadOnlySet<GraphFamily>> familiesByNoteId,
        IReadOnlyList<EdgeRecord> filteredEdges,
        IReadOnlyDictionary<string, int> depths,
        IReadOnlyCollection<string> included,
        string? entryNoteId)
    {
        var partitions = new List<GraphPartitionModel>();

        var sourceTreeNodes = included
            .Where(id => familiesByNoteId[id].Contains(GraphFamily.SourceTree))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var sourceTreeEdges = filteredEdges
            .Where(edge => sourceTreeNodes.Contains(edge.SourceId) && sourceTreeNodes.Contains(edge.TargetId))
            .ToArray();

        var sourceTreeRoles = sourceTreeNodes.ToDictionary(
            id => id,
            _ => GraphPartitionNodeRole.Primary,
            StringComparer.OrdinalIgnoreCase);

        partitions.Add(new GraphPartitionModel
        {
            Key = "source-tree",
            Title = "Source Tree Graph",
            Family = GraphFamily.SourceTree,
            IncludedNoteIds = sourceTreeNodes,
            Edges = sourceTreeEdges,
            NodeRoles = sourceTreeRoles,
            EntryNoteId = entryNoteId is not null && sourceTreeNodes.Contains(entryNoteId) ? entryNoteId : null,
        });

        var controlFlowPrimaryNodes = included
            .Where(id => familiesByNoteId[id].Contains(GraphFamily.ControlFlow))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (controlFlowPrimaryNodes.Count > 0)
        {
            var controlFlowAnchorNodes = filteredEdges
                .Where(edge =>
                    controlFlowPrimaryNodes.Contains(edge.SourceId) ^ controlFlowPrimaryNodes.Contains(edge.TargetId))
                .Select(edge => controlFlowPrimaryNodes.Contains(edge.SourceId) ? edge.TargetId : edge.SourceId)
                .Where(id =>
                    !controlFlowPrimaryNodes.Contains(id) &&
                    !string.Equals(id, entryNoteId, StringComparison.OrdinalIgnoreCase))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var controlFlowNodes = controlFlowPrimaryNodes
                .Concat(controlFlowAnchorNodes)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var controlFlowEdges = filteredEdges
                .Where(edge =>
                    controlFlowNodes.Contains(edge.SourceId) &&
                    controlFlowNodes.Contains(edge.TargetId) &&
                    (controlFlowPrimaryNodes.Contains(edge.SourceId) || controlFlowPrimaryNodes.Contains(edge.TargetId)))
                .ToArray();

            var roles = new Dictionary<string, GraphPartitionNodeRole>(StringComparer.OrdinalIgnoreCase);
            foreach (var nodeId in controlFlowPrimaryNodes)
            {
                roles[nodeId] = GraphPartitionNodeRole.Primary;
            }

            foreach (var nodeId in controlFlowAnchorNodes)
            {
                roles[nodeId] = GraphPartitionNodeRole.Anchor;
            }

            var controlEntry = controlFlowPrimaryNodes
                .OrderBy(id => depths.GetValueOrDefault(id, int.MaxValue))
                .ThenBy(id => id, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault();

            partitions.Add(new GraphPartitionModel
            {
                Key = "control-flow",
                Title = "Control Flow Graph",
                Family = GraphFamily.ControlFlow,
                IncludedNoteIds = controlFlowNodes,
                Edges = controlFlowEdges,
                NodeRoles = roles,
                EntryNoteId = controlEntry,
            });
        }

        return partitions;
    }

    private static bool ShareFamily(IReadOnlySet<GraphFamily> left, IReadOnlySet<GraphFamily> right) =>
        left.Any(right.Contains);
}

sealed record NoteRecord(
    string VaultRoot,
    string Id,
    string BaseName,
    string RelativePath,
    string RelativeStem,
    string FullPath,
    string DirectoryPath,
    string Content)
{
    public static NoteRecord FromFile(string vaultRoot, string path)
    {
        var fullPath = Path.GetFullPath(path);
        var relativePath = Path.GetRelativePath(vaultRoot, fullPath).Replace('\\', '/');
        var relativeStem = Path.ChangeExtension(relativePath, null)!.Replace('\\', '/');
        return new NoteRecord(
            vaultRoot,
            relativeStem,
            Path.GetFileNameWithoutExtension(fullPath),
            relativePath,
            relativeStem,
            fullPath,
            Path.GetDirectoryName(fullPath)!,
            File.ReadAllText(fullPath));
    }
}

sealed record EdgeRecord(string SourceId, string TargetId);

sealed class GraphPartitionModel
{
    public required string Key { get; init; }
    public required string Title { get; init; }
    public required GraphFamily Family { get; init; }
    public required IReadOnlyCollection<string> IncludedNoteIds { get; init; }
    public required IReadOnlyList<EdgeRecord> Edges { get; init; }
    public required IReadOnlyDictionary<string, GraphPartitionNodeRole> NodeRoles { get; init; }
    public required string? EntryNoteId { get; init; }
}

static class GraphLayoutBuilder
{
    public static Graph Build(GraphPartitionModel partition, VaultGraphModel model, GraphGenerationRequest request)
    {
        var graph = new Graph($"{request.GraphTitle} - {partition.Title}")
        {
            Attr =
            {
                LayerDirection = LayerDirection.TB,
                NodeSeparation = partition.Family == GraphFamily.ControlFlow ? 56 : 42,
                LayerSeparation = partition.Family == GraphFamily.ControlFlow ? 104 : 86,
                BackgroundColor = Color.White,
            },
        };

        graph.LayoutAlgorithmSettings = CreateLayoutSettings(request.LayoutMode, partition);
        var metricsByNodeId = new Dictionary<string, LabelMetrics>(StringComparer.OrdinalIgnoreCase);

        foreach (var noteId in partition.IncludedNoteIds.OrderBy(id => model.DepthById.GetValueOrDefault(id)).ThenBy(id => id, StringComparer.OrdinalIgnoreCase))
        {
            var note = model.NotesById[noteId];
            var depth = model.DepthById.GetValueOrDefault(noteId, -1);
            var isRoot = string.Equals(noteId, partition.EntryNoteId, StringComparison.OrdinalIgnoreCase);
            var families = model.FamiliesByNoteId[noteId];
            var role = partition.NodeRoles[noteId];
            var label = CreateDisplayLabel(note);
            var metrics = LabelMetrics.Estimate(label, depth, isRoot, role == GraphPartitionNodeRole.Anchor);
            metricsByNodeId[noteId] = metrics;

            var node = graph.AddNode(noteId);
            node.LabelText = label;
            node.Attr.Shape = Shape.Box;
            ApplyNodeStyle(node, depth, isRoot, families, role, metrics);
            node.NodeBoundaryDelegate = _ => CurveFactory.CreateRectangle(metrics.Width, metrics.Height, new Point());

            if (node.Label is not null)
            {
                node.Label.Width = metrics.LabelWidth;
                node.Label.Height = metrics.LabelHeight;
                node.Label.FontSize = isRoot ? 16 : role == GraphPartitionNodeRole.Anchor ? 12 : 13;
            }
        }

        foreach (var edgeRecord in partition.Edges)
        {
            var edge = graph.AddEdge(edgeRecord.SourceId, edgeRecord.TargetId);
            var sourceRole = partition.NodeRoles[edgeRecord.SourceId];
            var targetRole = partition.NodeRoles[edgeRecord.TargetId];
            edge.Attr.Color = sourceRole == GraphPartitionNodeRole.Anchor || targetRole == GraphPartitionNodeRole.Anchor
                ? Color.DarkGray
                : partition.Family == GraphFamily.ControlFlow ? Color.IndianRed : Color.Gray;
            edge.Attr.LineWidth = sourceRole == GraphPartitionNodeRole.Anchor || targetRole == GraphPartitionNodeRole.Anchor
                ? 0.9
                : 1.1;
        }

        graph.CreateGeometryGraph();

        foreach (var drawingNode in graph.Nodes)
        {
            var metrics = metricsByNodeId[drawingNode.Id];
            drawingNode.GeometryNode.BoundaryCurve =
                NodeBoundaryCurves.GetNodeBoundaryCurve(drawingNode, metrics.Width, metrics.Height);

            if (drawingNode.Label is not null)
            {
                drawingNode.Label.GeometryLabel = new Microsoft.Msagl.Core.Layout.Label(
                    metrics.LabelWidth,
                    metrics.LabelHeight,
                    drawingNode.GeometryNode);
            }
        }

        LayoutHelpers.CalculateLayout(graph.GeometryGraph, graph.LayoutAlgorithmSettings, null);
        return graph;
    }

    private static void ApplyNodeStyle(
        Node node,
        int depth,
        bool isRoot,
        IReadOnlySet<GraphFamily> families,
        GraphPartitionNodeRole role,
        LabelMetrics metrics)
    {
        node.Attr.LabelMargin = metrics.Padding;
        if (isRoot)
        {
            node.Attr.FillColor = Color.LightSteelBlue;
            node.Attr.Color = Color.MidnightBlue;
            node.Attr.LineWidth = 2.2;
            return;
        }

        if (role == GraphPartitionNodeRole.Anchor)
        {
            node.Attr.FillColor = Color.Gainsboro;
            node.Attr.Color = Color.DimGray;
            node.Attr.LineWidth = 1.0;
            return;
        }

        if (families.Contains(GraphFamily.ControlFlow))
        {
            node.Attr.FillColor = depth switch
            {
                <= 1 => Color.MistyRose,
                2 => Color.Linen,
                _ => Color.SeaShell,
            };
            node.Attr.Color = Color.IndianRed;
            node.Attr.LineWidth = 1.5;
            return;
        }

        node.Attr.FillColor = depth switch
        {
            0 => Color.LightSteelBlue,
            1 => Color.LightGoldenrodYellow,
            2 => Color.Honeydew,
            3 => Color.AliceBlue,
            _ => Color.White,
        };
        node.Attr.Color = Color.DarkSlateGray;
        node.Attr.LineWidth = 1.2;
    }

    private static Microsoft.Msagl.Core.Layout.LayoutAlgorithmSettings CreateLayoutSettings(
        LayoutMode layoutMode,
        GraphPartitionModel partition)
    {
        return layoutMode switch
        {
            LayoutMode.Mds => new MdsLayoutSettings
            {
                NodeSeparation = partition.Family == GraphFamily.ControlFlow ? 88 : 60,
                ScaleX = partition.Family == GraphFamily.ControlFlow ? 1.45 : 1.24,
                ScaleY = partition.Family == GraphFamily.ControlFlow ? 1.3 : 1.38,
                IterationsWithMajorization = partition.Family == GraphFamily.ControlFlow ? 52 : 46,
                EdgeRoutingSettings =
                {
                    EdgeRoutingMode = EdgeRoutingMode.StraightLine,
                },
            },
            _ => new SugiyamaLayoutSettings
            {
                NodeSeparation = partition.Family == GraphFamily.ControlFlow ? 90 : 56,
                LayerSeparation = partition.Family == GraphFamily.ControlFlow ? 132 : 112,
                EdgeRoutingSettings =
                {
                    EdgeRoutingMode = EdgeRoutingMode.Spline,
                },
            },
        };
    }

    private static string CreateDisplayLabel(NoteRecord note)
    {
        return note.BaseName.Length <= 36 ? note.BaseName : $"{note.BaseName[..33]}...";
    }
}

readonly record struct LabelMetrics(double Width, double Height, double LabelWidth, double LabelHeight, int Padding)
{
    public static LabelMetrics Estimate(string label, int depth, bool isRoot, bool isAnchor)
    {
        var fontSize = isRoot ? 16 : isAnchor ? 12 : 13;
        var padding = isRoot ? 16 : isAnchor ? 10 : 12;
        var charactersPerLine = isAnchor ? 24 : depth <= 1 ? 26 : 22;
        var wrappedLines = Math.Max(1, (int)Math.Ceiling(label.Length / (double)charactersPerLine));
        var lineHeight = fontSize * 1.55;
        var labelHeight = Math.Max(lineHeight, wrappedLines * lineHeight);
        var longestLine = Math.Min(label.Length, charactersPerLine);
        var labelWidth = Math.Max(80, longestLine * (fontSize * 0.64));
        return new LabelMetrics(
            Width: labelWidth + padding * 2,
            Height: labelHeight + padding * 2,
            LabelWidth: labelWidth,
            LabelHeight: labelHeight,
            Padding: padding);
    }
}

sealed class LayoutReport
{
    public required string GeneratedAtUtc { get; init; }
    public required string VaultRoot { get; init; }
    public required string GraphKey { get; init; }
    public required string GraphTitle { get; init; }
    public required string? EntryNote { get; init; }
    public required string LayoutMode { get; init; }
    public required int NodeCount { get; init; }
    public required int EdgeCount { get; init; }
    public required IReadOnlyList<string> Warnings { get; init; }
    public required IReadOnlyList<LayoutNodeRecord> Nodes { get; init; }
    public required IReadOnlyList<LayoutEdgeRecord> Edges { get; init; }

    public static LayoutReport From(GraphPartitionModel partition, VaultGraphModel model, Graph graph, GraphGenerationRequest request)
    {
        var nodeLookup = graph.Nodes.ToDictionary(node => node.Id, StringComparer.OrdinalIgnoreCase);
        var nodes = partition.IncludedNoteIds
            .OrderBy(id => model.DepthById.GetValueOrDefault(id))
            .ThenBy(id => id, StringComparer.OrdinalIgnoreCase)
            .Select(id =>
            {
                var note = model.NotesById[id];
                var node = nodeLookup[id];
                return new LayoutNodeRecord
                {
                    Id = id,
                    Title = note.BaseName,
                    RelativePath = note.RelativePath,
                    Depth = model.DepthById.GetValueOrDefault(id, -1),
                    FamilyMembership = model.FamiliesByNoteId[id].Select(f => f.ToApiValue()).OrderBy(x => x).ToArray(),
                    Role = partition.NodeRoles[id].ToApiValue(),
                    Bounds = new BoundsRecord
                    {
                        Left = node.BoundingBox.Left,
                        Bottom = node.BoundingBox.Bottom,
                        Width = node.BoundingBox.Width,
                        Height = node.BoundingBox.Height,
                    },
                    IsEntry = string.Equals(id, partition.EntryNoteId, StringComparison.OrdinalIgnoreCase),
                };
            })
            .ToArray();

        var edges = graph.Edges
            .Select(edge => new LayoutEdgeRecord
            {
                SourceId = edge.SourceNode.Id,
                TargetId = edge.TargetNode.Id,
                Label = edge.LabelText,
            })
            .ToArray();

        return new LayoutReport
        {
            GeneratedAtUtc = DateTime.UtcNow.ToString("O"),
            VaultRoot = model.VaultRoot,
            GraphKey = partition.Key,
            GraphTitle = partition.Title,
            EntryNote = partition.EntryNoteId,
            LayoutMode = request.LayoutMode.ToApiValue(),
            NodeCount = nodes.Length,
            EdgeCount = edges.Length,
            Warnings = model.Warnings,
            Nodes = nodes,
            Edges = edges,
        };
    }
}

sealed class LayoutNodeRecord
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public required string RelativePath { get; init; }
    public required int Depth { get; init; }
    public required IReadOnlyList<string> FamilyMembership { get; init; }
    public required string Role { get; init; }
    public required bool IsEntry { get; init; }
    public required BoundsRecord Bounds { get; init; }
}

sealed class LayoutEdgeRecord
{
    public required string SourceId { get; init; }
    public required string TargetId { get; init; }
    public string? Label { get; init; }
}

sealed class BoundsRecord
{
    public required double Left { get; init; }
    public required double Bottom { get; init; }
    public required double Width { get; init; }
    public required double Height { get; init; }
}

sealed class GraphPartitionResult
{
    public required string Key { get; init; }
    public required string Title { get; init; }
    public required string SvgPath { get; init; }
    public required string MsaglSvgPath { get; init; }
    public required string RichSvgPath { get; init; }
    public required string JsonPath { get; init; }
    public required string RendererMode { get; init; }
    public required int NodeCount { get; init; }
    public required int EdgeCount { get; init; }
}

sealed class CrossFamilyLinkReport
{
    public required int Count { get; init; }
    public required IReadOnlyList<CrossFamilyLinkRecord> Links { get; init; }

    public static CrossFamilyLinkReport From(VaultGraphModel model)
    {
        var links = model.CrossFamilyEdges
            .OrderBy(edge => edge.SourceId, StringComparer.OrdinalIgnoreCase)
            .ThenBy(edge => edge.TargetId, StringComparer.OrdinalIgnoreCase)
            .Select(edge => new CrossFamilyLinkRecord
            {
                SourceId = edge.SourceId,
                SourceTitle = model.NotesById[edge.SourceId].BaseName,
                SourceFamilies = model.FamiliesByNoteId[edge.SourceId].Select(f => f.ToApiValue()).OrderBy(x => x).ToArray(),
                TargetId = edge.TargetId,
                TargetTitle = model.NotesById[edge.TargetId].BaseName,
                TargetFamilies = model.FamiliesByNoteId[edge.TargetId].Select(f => f.ToApiValue()).OrderBy(x => x).ToArray(),
            })
            .ToArray();

        return new CrossFamilyLinkReport
        {
            Count = links.Length,
            Links = links,
        };
    }
}

sealed class CrossFamilyLinkRecord
{
    public required string SourceId { get; init; }
    public required string SourceTitle { get; init; }
    public required IReadOnlyList<string> SourceFamilies { get; init; }
    public required string TargetId { get; init; }
    public required string TargetTitle { get; init; }
    public required IReadOnlyList<string> TargetFamilies { get; init; }
}

static class LinkPatterns
{
    public static readonly Regex Wikilinks = new(@"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]", RegexOptions.Compiled);
    public static readonly Regex MarkdownLinks = new(@"\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)", RegexOptions.Compiled);
}

enum GraphFamily
{
    SourceTree,
    ControlFlow,
}

enum GraphPartitionNodeRole
{
    Primary,
    Anchor,
}

static class GraphFamilyExtensions
{
    public static string GetDefaultRootTitle(this GraphFamily family) =>
        family switch
        {
            GraphFamily.SourceTree => "Source Tree Map",
            GraphFamily.ControlFlow => "Control Flow Map",
            _ => throw new ArgumentOutOfRangeException(nameof(family), family, null),
        };

    public static string ToApiValue(this GraphFamily family) =>
        family switch
        {
            GraphFamily.SourceTree => "source-tree",
            GraphFamily.ControlFlow => "control-flow",
            _ => throw new ArgumentOutOfRangeException(nameof(family), family, null),
        };
}

static class GraphPartitionNodeRoleExtensions
{
    public static string ToApiValue(this GraphPartitionNodeRole role) =>
        role switch
        {
            GraphPartitionNodeRole.Primary => "primary",
            GraphPartitionNodeRole.Anchor => "anchor",
            _ => throw new ArgumentOutOfRangeException(nameof(role), role, null),
        };
}

static class NoteFamilyClassifier
{
    public static IReadOnlySet<GraphFamily> Classify(NoteRecord note)
    {
        var annotated = FrontMatterGraphFamilyParser.TryParseFamilies(note.Content);
        if (annotated.Count > 0)
        {
            return annotated;
        }

        if (note.BaseName.Contains("Control Flow", StringComparison.OrdinalIgnoreCase))
        {
            return new HashSet<GraphFamily> { GraphFamily.ControlFlow };
        }

        return new HashSet<GraphFamily> { GraphFamily.SourceTree };
    }
}

static class FrontMatterGraphFamilyParser
{
    private static readonly string[] FamilyKeys =
    [
        "epiphany-graph-family",
        "epiphany-graph-families",
        "graph-family",
        "graph-families",
    ];

    public static IReadOnlySet<GraphFamily> TryParseFamilies(string content)
    {
        var result = new HashSet<GraphFamily>();
        if (!content.StartsWith("---", StringComparison.Ordinal))
        {
            return result;
        }

        var lines = content.Replace("\r\n", "\n").Split('\n');
        if (lines.Length < 3 || lines[0].Trim() != "---")
        {
            return result;
        }

        for (var i = 1; i < lines.Length; i++)
        {
            var line = lines[i];
            if (line.Trim() == "---")
            {
                break;
            }

            var colon = line.IndexOf(':');
            if (colon <= 0)
            {
                continue;
            }

            var key = line[..colon].Trim();
            if (!FamilyKeys.Contains(key, StringComparer.OrdinalIgnoreCase))
            {
                continue;
            }

            var value = line[(colon + 1)..].Trim();
            if (!string.IsNullOrWhiteSpace(value))
            {
                foreach (var family in ParseFamilyValues(value))
                {
                    result.Add(family);
                }
                continue;
            }

            for (var j = i + 1; j < lines.Length; j++)
            {
                var nested = lines[j].Trim();
                if (nested == "---" || !nested.StartsWith("-", StringComparison.Ordinal))
                {
                    break;
                }

                foreach (var family in ParseFamilyValues(nested[1..].Trim()))
                {
                    result.Add(family);
                }
            }
        }

        return result;
    }

    private static IEnumerable<GraphFamily> ParseFamilyValues(string raw)
    {
        var normalized = raw
            .Trim()
            .Trim('[', ']');

        foreach (var token in normalized.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var cleaned = token.Trim().Trim('"', '\'');
            if (cleaned.Equals("source-tree", StringComparison.OrdinalIgnoreCase) ||
                cleaned.Equals("source_tree", StringComparison.OrdinalIgnoreCase) ||
                cleaned.Equals("source tree", StringComparison.OrdinalIgnoreCase))
            {
                yield return GraphFamily.SourceTree;
            }
            else if (cleaned.Equals("control-flow", StringComparison.OrdinalIgnoreCase) ||
                     cleaned.Equals("control_flow", StringComparison.OrdinalIgnoreCase) ||
                     cleaned.Equals("control flow", StringComparison.OrdinalIgnoreCase))
            {
                yield return GraphFamily.ControlFlow;
            }
        }
    }
}

sealed class StringTupleComparer : IEqualityComparer<(string left, string right)>
{
    public static readonly StringTupleComparer OrdinalIgnoreCase = new(StringComparer.OrdinalIgnoreCase);

    private readonly StringComparer _comparer;

    private StringTupleComparer(StringComparer comparer)
    {
        _comparer = comparer;
    }

    public bool Equals((string left, string right) x, (string left, string right) y) =>
        _comparer.Equals(x.left, y.left) && _comparer.Equals(x.right, y.right);

    public int GetHashCode((string left, string right) obj) =>
        HashCode.Combine(_comparer.GetHashCode(obj.left), _comparer.GetHashCode(obj.right));
}

static class EnumerableExtensions
{
    public static IEnumerable<TSource> DistinctBy<TSource, TKey>(
        this IEnumerable<TSource> source,
        Func<TSource, TKey> keySelector,
        IEqualityComparer<TKey>? comparer = null)
    {
        var seen = new HashSet<TKey>(comparer);
        foreach (var item in source)
        {
            if (seen.Add(keySelector(item)))
            {
                yield return item;
            }
        }
    }

    public static TValue GetValueOrDefault<TKey, TValue>(
        this IReadOnlyDictionary<TKey, TValue> dictionary,
        TKey key,
        TValue fallback = default!)
        where TKey : notnull
    {
        return dictionary.TryGetValue(key, out var value) ? value : fallback;
    }
}
