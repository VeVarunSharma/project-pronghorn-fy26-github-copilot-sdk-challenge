import { Octokit } from "@octokit/rest";

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface RepoResult {
  repoUrl: string;
  repoName: string;
  filesCreated: number;
}

export class GitHubService {
  private octokit: Octokit;
  private org: string;

  constructor(token: string, org: string) {
    this.octokit = new Octokit({ auth: token });
    this.org = org;
  }

  async createRepo(name: string, description: string): Promise<string> {
    const sanitized = name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 100);
    const { data } = await this.octokit.repos.createInOrg({
      org: this.org,
      name: sanitized,
      description,
      auto_init: true,
      private: false,
      has_issues: true,
      has_projects: false,
      has_wiki: false,
      delete_branch_on_merge: true,
    });
    return data.html_url;
  }

  async pushFiles(
    repoName: string,
    files: GeneratedFile[],
    commitMessage: string
  ): Promise<number> {
    const sanitized = repoName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 100);

    const { data: ref } = await this.octokit.git.getRef({
      owner: this.org,
      repo: sanitized,
      ref: "heads/main",
    });
    const parentSha = ref.object.sha;

    const { data: parentCommit } = await this.octokit.git.getCommit({
      owner: this.org,
      repo: sanitized,
      commit_sha: parentSha,
    });

    const treeItems = await Promise.all(
      files.map(async (file) => {
        const { data: blob } = await this.octokit.git.createBlob({
          owner: this.org,
          repo: sanitized,
          content: Buffer.from(file.content).toString("base64"),
          encoding: "base64",
        });
        return {
          path: file.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        };
      })
    );

    const { data: tree } = await this.octokit.git.createTree({
      owner: this.org,
      repo: sanitized,
      base_tree: parentCommit.tree.sha,
      tree: treeItems,
    });

    const { data: newCommit } = await this.octokit.git.createCommit({
      owner: this.org,
      repo: sanitized,
      message: commitMessage,
      tree: tree.sha,
      parents: [parentSha],
    });

    await this.octokit.git.updateRef({
      owner: this.org,
      repo: sanitized,
      ref: "heads/main",
      sha: newCommit.sha,
    });

    return files.length;
  }

  async configureSecurity(repoName: string): Promise<string[]> {
    const sanitized = repoName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 100);
    const actions: string[] = [];

    try {
      await this.octokit.repos.enableVulnerabilityAlerts({
        owner: this.org,
        repo: sanitized,
      });
      actions.push("Dependabot vulnerability alerts enabled");
    } catch {
      actions.push("Dependabot alerts: skipped (may require admin)");
    }

    try {
      await this.octokit.repos.enableAutomatedSecurityFixes({
        owner: this.org,
        repo: sanitized,
      });
      actions.push("Automated security fixes enabled");
    } catch {
      actions.push("Automated security fixes: skipped (may require admin)");
    }

    try {
      await this.octokit.repos.updateBranchProtection({
        owner: this.org,
        repo: sanitized,
        branch: "main",
        required_status_checks: null,
        enforce_admins: true,
        required_pull_request_reviews: {
          required_approving_review_count: 1,
          dismiss_stale_reviews: true,
        },
        restrictions: null,
      });
      actions.push(
        "Branch protection enabled (1 review required, stale dismissal)"
      );
    } catch {
      actions.push("Branch protection: skipped (may require admin)");
    }

    return actions;
  }

  async createIssues(
    repoName: string,
    issues: { title: string; body: string; labels: string[] }[]
  ): Promise<{ number: number; title: string; url: string }[]> {
    const sanitized = repoName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 100);

    // Create labels first (ignore errors if they exist)
    const allLabels = [...new Set(issues.flatMap((i) => i.labels))];
    const labelColors: Record<string, string> = {
      "feature": "0075ca",
      "enhancement": "a2eeef",
      "security": "e11d48",
      "infrastructure": "7c3aed",
      "testing": "15803d",
      "documentation": "0969da",
      "copilot-agent": "8b5cf6",
      "pronghorn-generated": "f97316",
    };
    for (const label of allLabels) {
      try {
        await this.octokit.issues.createLabel({
          owner: this.org,
          repo: sanitized,
          name: label,
          color: labelColors[label] || "cccccc",
        });
      } catch {
        // label already exists
      }
    }

    const created: { number: number; title: string; url: string }[] = [];
    for (const issue of issues) {
      try {
        const { data } = await this.octokit.issues.create({
          owner: this.org,
          repo: sanitized,
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
        });
        created.push({ number: data.number, title: data.title, url: data.html_url });
      } catch (err) {
        console.error(`[Pronghorn] Failed to create issue "${issue.title}":`, err);
      }
    }

    return created;
  }
}
