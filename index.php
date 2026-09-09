<?php
/**
 * dotvet — Official Documentation & Homepage
 * Maintained by EthicCode Technologies (https://ethiccode.in)
 * Canonical URL: https://ethiccode.in/dotvet
 */

$app_name = "dotvet";
$version = "0.1.0";
$maker = "EthicCode Technologies";
$site_url = "https://ethiccode.in/dotvet";
$pypi_url = "https://pypi.org/project/dotvet/";
$npm_url = "https://www.npmjs.com/package/dotvet";
$github_url = "https://github.com/EthicCodes/dotvet";
$contact_email = "contact@ethiccode.in";
$current_year = date("Y");
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars($app_name) ?> — Never Ship Weak or Missing .env Secrets | <?= htmlspecialchars($maker) ?></title>
    <meta name="description" content="dotvet scans your codebase to find every environment variable your app needs, checks that your .env file has safe values (no 'changeme', no weak secrets), and blocks broken deployments.">
    <meta name="author" content="<?= htmlspecialchars($maker) ?>">
    
    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
    
    <!-- Tailwind CSS (Light Theme) -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['"Inter"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
                        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
                    }
                }
            }
        }
    </script>
    <style>
        body {
            background-color: #ffffff;
            color: #0f172a;
            -webkit-font-smoothing: antialiased;
        }
        .code-dark {
            background-color: #090d16;
            color: #f1f5f9;
        }
        .border-subtle {
            border: 1px solid #e2e8f0;
        }
    </style>
</head>
<body class="min-h-screen flex flex-col">

    <!-- Top Announcement -->
    <div class="bg-slate-900 text-white text-xs py-2 px-4 text-center font-medium">
        <span>🎉 <strong>dotvet v<?= htmlspecialchars($version) ?></strong> is now live on </span>
        <a href="<?= htmlspecialchars($npm_url) ?>" target="_blank" class="underline text-cyan-400 hover:text-cyan-300">npm</a>
        <span> and </span>
        <a href="<?= htmlspecialchars($pypi_url) ?>" target="_blank" class="underline text-cyan-400 hover:text-cyan-300">PyPI</a>
        <span> &bull; Zero dependencies &bull; Ready to use immediately</span>
    </div>

    <!-- Navigation -->
    <header class="border-b border-slate-200 bg-white sticky top-0 z-40">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <div class="flex items-center gap-3">
                <a href="#" class="flex items-center gap-2">
                    <span class="w-8 h-8 rounded-md bg-slate-900 text-white flex items-center justify-center font-mono font-bold text-sm shadow-sm">dv</span>
                    <span class="font-extrabold text-xl tracking-tight text-slate-900"><?= htmlspecialchars($app_name) ?></span>
                </a>
                <span class="text-slate-300">|</span>
                <span class="text-xs text-slate-500 font-medium">by <a href="https://ethiccode.in" target="_blank" class="text-slate-700 hover:text-blue-600 underline font-semibold"><?= htmlspecialchars($maker) ?></a></span>
            </div>

            <nav class="hidden sm:flex items-center gap-6 text-sm font-medium text-slate-600">
                <a href="#what-it-does" class="hover:text-slate-900">What It Does</a>
                <a href="#how-it-works" class="hover:text-slate-900">How It Works</a>
                <a href="#quickstart" class="hover:text-slate-900">Quickstart</a>
                <a href="#commands" class="hover:text-slate-900">Commands</a>
                <a href="<?= htmlspecialchars($github_url) ?>" target="_blank" class="text-slate-800 hover:text-blue-600 font-semibold">GitHub &rarr;</a>
            </nav>
        </div>
    </header>

    <main class="flex-grow max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-16">

        <!-- HERO: Crystal Clear Value Proposition (WHAT IS IT & WHAT DOES IT DO) -->
        <section class="space-y-6 pt-4">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold">
                <span>🛡️ Developer Security CLI Tool</span>
            </div>

            <h1 class="text-4xl sm:text-5xl font-extrabold text-slate-950 tracking-tight leading-[1.15]">
                Never ship missing, broken, or weak <code class="bg-slate-100 text-blue-700 px-2 py-0.5 rounded">.env</code> secrets to production.
            </h1>

            <p class="text-lg sm:text-xl text-slate-600 max-w-3xl leading-relaxed">
                <strong>dotvet</strong> is a command-line tool that scans your codebase, finds every environment variable your application needs, checks that your <code class="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-base">.env</code> has <strong>real, safe values</strong> (no "changeme", no dummy passwords, no short JWT secrets), and <strong>stops your build if anything is insecure</strong>.
            </p>

            <!-- Quick Run Bar -->
            <div id="quickstart" class="p-4 sm:p-5 rounded-xl border border-slate-300 bg-slate-50 space-y-3 shadow-sm">
                <div class="text-xs font-semibold uppercase tracking-wider text-slate-600">Run It In Your Project Right Now (No Installation Required):</div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <!-- Node -->
                    <div class="space-y-1">
                        <div class="text-xs text-slate-600 font-medium">JavaScript / TypeScript / Node.js:</div>
                        <div class="code-dark p-3 rounded-lg flex items-center justify-between font-mono text-sm">
                            <span class="text-cyan-300">npx dotvet</span>
                            <button onclick="copyCmd('npx dotvet', this)" class="text-xs bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-slate-300">Copy</button>
                        </div>
                    </div>

                    <!-- Python -->
                    <div class="space-y-1">
                        <div class="text-xs text-slate-600 font-medium">Python:</div>
                        <div class="code-dark p-3 rounded-lg flex items-center justify-between font-mono text-sm">
                            <span class="text-cyan-300">pip install dotvet && dotvet</span>
                            <button onclick="copyCmd('pip install dotvet && dotvet', this)" class="text-xs bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-slate-300">Copy</button>
                        </div>
                    </div>
                </div>

                <div class="text-xs text-slate-500 pt-1 flex flex-wrap gap-4">
                    <span>✔ Scans in under 200ms</span>
                    <span>✔ Zero dependencies (safe from supply chain attacks)</span>
                    <span>✔ Exits with code 1 in CI if secrets are unsafe</span>
                </div>
            </div>
        </section>

        <!-- THE CORE PROBLEM & THE SOLUTION (SIDE-BY-SIDE VISUAL) -->
        <section id="what-it-does" class="space-y-6 pt-6 border-t border-slate-200">
            <div>
                <h2 class="text-2xl font-bold text-slate-900">Why Do You Need This?</h2>
                <p class="text-slate-600 text-sm mt-1">The difference between standard tools and dotvet in 10 seconds:</p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- WITHOUT DOTVET -->
                <div class="rounded-xl border border-red-200 bg-red-50/50 p-6 space-y-4">
                    <div class="flex items-center gap-2 text-red-700 font-bold text-base">
                        <span>❌ WITHOUT dotvet (How apps get hacked)</span>
                    </div>

                    <div class="bg-white border border-red-200 rounded p-3 font-mono text-xs text-slate-700 space-y-1">
                        <div class="text-slate-400"># Your .env file:</div>
                        <div>PORT=3000</div>
                        <div class="bg-red-100 text-red-900 font-bold px-1 rounded">JWT_SECRET=secret</div>
                        <div class="bg-red-100 text-red-900 font-bold px-1 rounded">DATABASE_URL=changeme</div>
                    </div>

                    <div class="text-xs text-red-800 space-y-2 leading-relaxed">
                        <p><strong>What existing tools (like dotenv-safe) do:</strong></p>
                        <p>&ldquo;All variables exist! Build passed! ✅&rdquo;</p>
                        <p class="font-medium text-red-900">
                            <strong>The Reality:</strong> Existing tools only check if a variable exists. They don't care if it's garbage. Your app deploys with <code class="bg-red-100 px-1 py-0.5 rounded text-red-900 font-mono">JWT_SECRET="secret"</code>, allowing hackers to forge admin logins in seconds.
                        </p>
                    </div>
                </div>

                <!-- WITH DOTVET -->
                <div class="rounded-xl border border-emerald-200 bg-emerald-50/40 p-6 space-y-4">
                    <div class="flex items-center gap-2 text-emerald-800 font-bold text-base">
                        <span>✅ WITH dotvet (Automatic Protection)</span>
                    </div>

                    <div class="code-dark rounded p-3 font-mono text-xs text-slate-300 space-y-1.5">
                        <div class="text-slate-400">$ npx dotvet</div>
                        <div class="text-red-400 font-bold">FAIL: JWT_SECRET is only 6 chars. Minimum 32 required.</div>
                        <div class="text-red-400 font-bold">FAIL: DATABASE_URL is set to placeholder "changeme".</div>
                        <div class="text-yellow-300 pt-1">$ npx dotvet fix</div>
                        <div class="text-emerald-400">✔ Generated secure 32-byte (64-char) JWT secret.</div>
                        <div class="text-emerald-400">✔ Added .env to .gitignore. Build safe!</div>
                    </div>

                    <div class="text-xs text-emerald-900 space-y-2 leading-relaxed">
                        <p><strong>What dotvet does:</strong></p>
                        <p>
                            It audits the <strong>actual security quality</strong> of your values. It catches placeholder strings, enforces cryptographic strength on tokens, blocks broken pull requests, and can automatically repair them.
                        </p>
                    </div>
                </div>
            </div>
        </section>

        <!-- HOW IT WORKS IN 3 SIMPLE STEPS -->
        <section id="how-it-works" class="space-y-6 pt-6 border-t border-slate-200">
            <div>
                <h2 class="text-2xl font-bold text-slate-900">How It Works</h2>
                <p class="text-slate-600 text-sm mt-1">Zero configuration required. It inspects your real code and env files.</p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="border-subtle rounded-xl p-5 bg-white space-y-3">
                    <div class="w-8 h-8 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-sm font-mono">1</div>
                    <h3 class="font-bold text-slate-900 text-base">Auto-Scans Your Code</h3>
                    <p class="text-xs text-slate-600 leading-relaxed">
                        It looks through your JS, TS, Python, Go, and Docker files to find every environment variable your code calls (<code class="bg-slate-100 px-1 py-0.5 rounded font-mono">process.env.VAR</code> or <code class="bg-slate-100 px-1 py-0.5 rounded font-mono">os.getenv('VAR')</code>). You don't have to manually write schemas.
                    </p>
                </div>

                <div class="border-subtle rounded-xl p-5 bg-white space-y-3">
                    <div class="w-8 h-8 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-sm font-mono">2</div>
                    <h3 class="font-bold text-slate-900 text-base">Audits Security Quality</h3>
                    <p class="text-xs text-slate-600 leading-relaxed">
                        It compares your code's needs against your <code class="bg-slate-100 px-1 py-0.5 rounded font-mono">.env</code> file. Are any required vars missing? Are values dummy placeholders? Is your JWT secret under 32 characters?
                    </p>
                </div>

                <div class="border-subtle rounded-xl p-5 bg-white space-y-3">
                    <div class="w-8 h-8 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-sm font-mono">3</div>
                    <h3 class="font-bold text-slate-900 text-base">Protects & Auto-Heals</h3>
                    <p class="text-xs text-slate-600 leading-relaxed">
                        In CI, it halts the pipeline with exit code 1 to stop an insecure deploy. On your local machine, running <code class="bg-slate-100 px-1 py-0.5 rounded font-mono text-blue-700 font-bold">dotvet fix</code> automatically fills in secure random cryptographic secrets.
                    </p>
                </div>
            </div>
        </section>

        <!-- WHAT SPECIFIC CHECKS DOES IT PERFORM? -->
        <section class="space-y-4 pt-6 border-t border-slate-200">
            <div>
                <h2 class="text-2xl font-bold text-slate-900">What Errors Does It Catch?</h2>
                <p class="text-slate-600 text-sm mt-1">The specific mistakes dotvet prevents before they hit production:</p>
            </div>

            <div class="border-subtle rounded-xl overflow-hidden divide-y divide-slate-200 text-sm">
                <div class="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 bg-white">
                    <div class="space-y-1">
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded bg-red-100 text-red-800 text-xs font-bold font-mono">BLOCKS</span>
                            <span class="font-bold text-slate-900">Undersized JWT Signing Secrets</span>
                        </div>
                        <p class="text-xs text-slate-600">
                            HMAC-SHA256 tokens require 256 bits of entropy. Any variable named <code class="bg-slate-100 px-1 rounded font-mono">JWT_SECRET</code> under 32 characters causes an instant failure, preventing dictionary cracking.
                        </p>
                    </div>
                </div>

                <div class="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 bg-white">
                    <div class="space-y-1">
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded bg-red-100 text-red-800 text-xs font-bold font-mono">BLOCKS</span>
                            <span class="font-bold text-slate-900">Dummy Placeholders Left in Configs</span>
                        </div>
                        <p class="text-xs text-slate-600">
                            Catches values like <code class="bg-slate-100 px-1 rounded font-mono">"changeme"</code>, <code class="bg-slate-100 px-1 rounded font-mono">"your-secret-here"</code>, <code class="bg-slate-100 px-1 rounded font-mono">"dummy"</code>, <code class="bg-slate-100 px-1 rounded font-mono">"admin"</code>, or <code class="bg-slate-100 px-1 rounded font-mono">"123456"</code>.
                        </p>
                    </div>
                </div>

                <div class="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 bg-white">
                    <div class="space-y-1">
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded bg-red-100 text-red-800 text-xs font-bold font-mono">BLOCKS</span>
                            <span class="font-bold text-slate-900">Variables Missing or Empty</span>
                        </div>
                        <p class="text-xs text-slate-600">
                            Detects when your code needs a variable (e.g. <code class="bg-slate-100 px-1 rounded font-mono">DATABASE_URL</code>) but your <code class="bg-slate-100 px-1 rounded font-mono">.env</code> didn't provide it, preventing application boot crashes.
                        </p>
                    </div>
                </div>

                <div class="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 bg-white">
                    <div class="space-y-1">
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 text-xs font-bold font-mono">WARNS</span>
                            <span class="font-bold text-slate-900">Accidental Git Exposure</span>
                        </div>
                        <p class="text-xs text-slate-600">
                            Warns you immediately if a <code class="bg-slate-100 px-1 rounded font-mono">.env</code> file exists in your repository but isn't listed in your <code class="bg-slate-100 px-1 rounded font-mono">.gitignore</code> file.
                        </p>
                    </div>
                </div>
            </div>
        </section>

        <!-- COMMAND CHEAT SHEET -->
        <section id="commands" class="space-y-4 pt-6 border-t border-slate-200">
            <div>
                <h2 class="text-2xl font-bold text-slate-900">Command Reference</h2>
                <p class="text-slate-600 text-sm mt-1">The simple commands you can run:</p>
            </div>

            <div class="border-subtle rounded-xl overflow-hidden divide-y divide-slate-200 text-xs font-mono">
                <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
                    <div>
                        <span class="font-bold text-slate-900 text-sm">dotvet</span>
                        <p class="font-sans text-xs text-slate-600 mt-1">Default check. Scans code and audits your active .env file for errors and weak secrets.</p>
                    </div>
                    <span class="text-slate-500 font-sans text-xs">Exits 0 (passed) or 1 (failure)</span>
                </div>

                <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
                    <div>
                        <span class="font-bold text-blue-700 text-sm">dotvet fix</span>
                        <p class="font-sans text-xs text-slate-600 mt-1">Auto-repair. Generates secure 32-byte cryptographic keys, replaces placeholders, and updates .gitignore.</p>
                    </div>
                    <span class="text-emerald-700 font-sans text-xs font-semibold">Auto-Heal Mode</span>
                </div>

                <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
                    <div>
                        <span class="font-bold text-slate-900 text-sm">dotvet generate</span>
                        <p class="font-sans text-xs text-slate-600 mt-1">Generates .env.example and .env.schema.json contracts automatically from your code.</p>
                    </div>
                    <span class="text-slate-500 font-sans text-xs">Contract Generator</span>
                </div>

                <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
                    <div>
                        <span class="font-bold text-slate-900 text-sm">dotvet install-hook</span>
                        <p class="font-sans text-xs text-slate-600 mt-1">Installs a Git pre-commit hook so nobody on your team can commit insecure secrets.</p>
                    </div>
                    <span class="text-slate-500 font-sans text-xs">Pre-Commit Guard</span>
                </div>
            </div>
        </section>

        <!-- CI/CD INTEGRATION -->
        <section class="space-y-4 pt-6 border-t border-slate-200">
            <div>
                <h2 class="text-2xl font-bold text-slate-900">Add to GitHub Actions in 3 Lines</h2>
                <p class="text-slate-600 text-sm mt-1">Block broken pull requests before they reach your main branch:</p>
            </div>

            <div class="code-dark p-5 rounded-xl text-xs overflow-x-auto font-mono leading-relaxed">
                <span class="text-slate-500"># .github/workflows/check.yml</span><br>
                <span class="text-cyan-400">- name:</span> Audit Environment Variables<br>
                &nbsp;&nbsp;<span class="text-cyan-400">run:</span> npx dotvet check --ci --strict<br>
                &nbsp;&nbsp;<span class="text-cyan-400">env:</span><br>
                &nbsp;&nbsp;&nbsp;&nbsp;<span class="text-slate-400">JWT_SECRET:</span> ${{ secrets.CI_JWT_SECRET }}<br>
                &nbsp;&nbsp;&nbsp;&nbsp;<span class="text-slate-400">DATABASE_URL:</span> ${{ secrets.CI_DATABASE_URL }}
            </div>
        </section>

    </main>

    <!-- Clean Footer -->
    <footer class="border-t border-slate-200 bg-slate-50 py-12 text-xs text-slate-600">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div class="space-y-1 text-center sm:text-left">
                <p class="font-bold text-slate-900 text-sm">dotvet &bull; Built by <?= htmlspecialchars($maker) ?></p>
                <p class="text-slate-500">Official Website: <a href="https://ethiccode.in" target="_blank" class="text-blue-600 hover:underline">ethiccode.in</a> &bull; Email: <a href="mailto:<?= htmlspecialchars($contact_email) ?>" class="text-blue-600 hover:underline"><?= htmlspecialchars($contact_email) ?></a></p>
            </div>

            <div class="flex items-center gap-6 font-medium">
                <a href="<?= htmlspecialchars($npm_url) ?>" target="_blank" class="hover:text-slate-900">npm Package</a>
                <a href="<?= htmlspecialchars($pypi_url) ?>" target="_blank" class="hover:text-slate-900">PyPI Package</a>
                <a href="<?= htmlspecialchars($github_url) ?>" target="_blank" class="hover:text-slate-900">GitHub Repo</a>
                <a href="LICENSE" class="hover:text-slate-900">MIT License</a>
            </div>
        </div>
        <div class="max-w-5xl mx-auto px-4 sm:px-6 mt-8 pt-6 border-t border-slate-200 text-center text-slate-400 text-[11px]">
            &copy; <?= $current_year ?> <?= htmlspecialchars($maker) ?>. Released under the open-source MIT License.
        </div>
    </footer>

    <script>
        function copyCmd(cmd, btn) {
            navigator.clipboard.writeText(cmd).then(() => {
                const old = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => { btn.textContent = old; }, 1500);
            });
        }
    </script>
</body>
</html>
