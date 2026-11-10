// Ideas 111, 349, 350: guilds ("companies" made of several players' companies), ranks and guild flags.
// Ideas 358, 359: guild chat and a recruitment board.
import type { FeatureFactory } from "../types.js";
import { action, atLeast, cleanLabel, cleanText, companyOptions, DailyLimit, fail, guildName, guildOf, isCompany, isInt, members, name, OK,
  rankOf, RANKS, social, type Guild, type Rank } from "./shared.js";

export const MAX_MEMBERS = 8, TECH_MEMBERS = 4;
export const FLAG_COLOURS = ["#2c6fb7", "#c8432f", "#2e8b57", "#f0c64a", "#7b5cc4", "#1f7a7a", "#f4f1e8", "#151515", "#e8873a", "#d9b24c"];
export const memberCap = (g: Guild) => MAX_MEMBERS + (g.techs.has("muster") ? TECH_MEMBERS : 0);

export const guildsModule: FeatureFactory = (e) => {
  const id = "social.guilds";
  const leave = (company: number) => {
    const s = social(e), g = guildOf(e, company);
    if (!g) return;
    g.members.delete(company); s.memberOf.delete(company);
    const left = members(e, g);
    if (!left.length) { s.guilds.delete(g.id); return; }
    if (![...g.members.values()].includes("leader")) {   // hand over to the senior officer, else the oldest member
      const next = left.find(c => g.members.get(c) === "officer") ?? left[0];
      g.members.set(next, "leader");
    }
  };
  const join = (g: Guild, company: number) => { g.members.set(company, "member"); g.invites.delete(company); social(e).memberOf.set(company, g.id); };
  return {
    id, ideas: [111, 349, 350], title: "Guilds", economy: false,
    apply(cmd) {
      const s = social(e), mine = guildOf(e, cmd.company), rank = rankOf(e, cmd.company);
      switch (cmd.action) {
        case "create": {
          if (mine) return fail("leave your guild first");
          const gname = cleanLabel(cmd.name, 24, 3);
          if (!gname) return fail("guild names are 3-24 letters, digits and spaces");
          if (typeof cmd.tag !== "string" || !/^[A-Za-z0-9]{2,4}$/.test(cmd.tag)) return fail("tags are 2-4 letters or digits");
          const tag = cmd.tag.toUpperCase();
          if (!cleanLabel(tag, 4, 2)) return fail("choose another tag");
          if ([...s.guilds.values()].some(g => g.name.toLowerCase() === gname.toLowerCase() || g.tag === tag)) return fail("that name or tag is taken");
          const g: Guild = { id: s.nextGuild++, name: gname, tag, founded: e.tick, members: new Map([[cmd.company, "leader"]]), invites: new Set(),
            open: false, flag: [FLAG_COLOURS[0], FLAG_COLOURS[6]], hq: null, hqSince: -1e9, xp: 0, techs: new Set(), fame: [] };
          s.guilds.set(g.id, g); s.memberOf.set(cmd.company, g.id);
          return { ok: true, id: g.id };
        }
        case "invite": {
          if (!mine || !atLeast(rank, "officer")) return fail("only officers can invite");
          if (!isCompany(e, cmd.target) || cmd.target === cmd.company) return fail("choose a company");
          if (guildOf(e, cmd.target)) return fail("that company is already in a guild");
          mine.invites.add(cmd.target);
          return OK;
        }
        case "join": {
          if (mine) return fail("leave your guild first");
          const g = typeof cmd.guild === "number" ? s.guilds.get(cmd.guild) : undefined;
          if (!g) return fail("no such guild");
          if (!g.open && !g.invites.has(cmd.company)) return fail("that guild needs to invite you");
          if (members(e, g).length >= memberCap(g)) return fail("that guild is full");
          join(g, cmd.company);
          return OK;
        }
        case "leave": if (!mine) return fail("you are not in a guild"); leave(cmd.company); return OK;
        case "kick": {
          if (!mine || !atLeast(rank, "officer")) return fail("only officers can remove members");
          const r = typeof cmd.target === "number" ? mine.members.get(cmd.target) : undefined;
          if (!r || cmd.target === cmd.company) return fail("not a member");
          if (RANKS.indexOf(r) >= RANKS.indexOf(rank!)) return fail("you can only remove lower ranks");
          leave(cmd.target as number);
          return OK;
        }
        case "setRank": {
          if (!mine || rank !== "leader") return fail("only the leader sets ranks");
          const target = cmd.target as number;
          if (typeof target !== "number" || !mine.members.has(target) || target === cmd.company) return fail("not a member");
          if (!RANKS.includes(cmd.rank as Rank)) return fail("unknown rank");
          if (cmd.rank === "leader") mine.members.set(cmd.company, "officer");
          mine.members.set(target, cmd.rank as Rank);
          return OK;
        }
        case "setFlag": {
          if (!mine || !atLeast(rank, "officer")) return fail("only officers change the flag");
          if (!isInt(cmd.field, 0, FLAG_COLOURS.length - 1) || !isInt(cmd.charge, 0, FLAG_COLOURS.length - 1) || cmd.field === cmd.charge) return fail("choose two different colours");
          mine.flag = [FLAG_COLOURS[cmd.field], FLAG_COLOURS[cmd.charge]];
          return OK;
        }
        case "setOpen": {
          if (!mine || !atLeast(rank, "officer")) return fail("only officers change who may join");
          mine.open = cmd.open === true || cmd.open === 1;
          return OK;
        }
        default: return fail("unknown action");
      }
    },
    cards(company) {
      const g = guildOf(e, company), s = social(e);
      if (!g) {
        const can = [...s.guilds.values()].filter(x => (x.open || x.invites.has(company)) && members(e, x).length < memberCap(x));
        return [{ title: "Guilds", detail: "Team up with other companies: a shared flag, chat, HQ, missions and more. Create a guild in the Social panel."
          + (can.length ? `\nYou can join: ${can.map(x => `${x.name} [${x.tag}]${x.invites.has(company) ? " (invited)" : ""}`).join(", ")}` : ""),
          actions: can.slice(0, 6).map(x => action(id, `Join ${x.name}`, "join", { guild: x.id })) }];
      }
      const rank = g.members.get(company)!;
      const others = members(e, g).filter(c => c !== company);
      return [{ title: `${g.name} [${g.tag}]`, detail: `You are ${rank}. Members: ${members(e, g).map(c => `${name(e, c)} (${g.members.get(c)})`).join(", ")}. ${g.open ? "Anyone may join." : "Invite only."}`,
        actions: [
          ...(atLeast(rank, "officer") ? [{ ...action(id, "Invite a company", "invite"), fields: [{ key: "target", label: "Company", options: companyOptions(e, company).filter(o => !guildOf(e, o.value)) }] },
            { ...action(id, "Guild flag", "setFlag"), fields: [{ key: "field", label: "Field", options: FLAG_COLOURS.map((c, i) => ({ value: i, label: c })) }, { key: "charge", label: "Charge", value: 6, options: FLAG_COLOURS.map((c, i) => ({ value: i, label: c })) }] },
            action(id, g.open ? "Make invite-only" : "Open to all", "setOpen", { open: !g.open })] : []),
          ...(rank === "leader" && others.length ? [{ ...action(id, "Set a rank", "setRank"), fields: [{ key: "target", label: "Member", options: others.map(c => ({ value: c, label: name(e, c) })) },
            { key: "rank", label: "Rank", options: RANKS.map(r => ({ value: r, label: r })) }] }] : []),
          action(id, "Leave the guild", "leave"),
        ] }];
    },
    view(company) { const g = guildOf(e, company); return g ? { guild: g.id, rank: g.members.get(company), invites: [...g.invites] } : { guild: null, invitedTo: [...social(e).guilds.values()].filter(g => g.invites.has(company)).map(g => g.id) }; },
    world() {
      return [...social(e).guilds.values()].map(g => ({ id: g.id, name: g.name, tag: g.tag, flag: g.flag, open: g.open, hq: g.hq, xp: g.xp, techs: [...g.techs],
        members: members(e, g).map(c => ({ id: c, name: name(e, c), rank: g.members.get(c) })) }));
    },
  };
};

export const CHAT_KEPT = 50;
export const guildChatModule: FeatureFactory = (e) => {
  const chats = new Map<number, { tick: number; from: number; text: string }[]>();
  const limit = new DailyLimit(e, 200);
  return {
    id: "social.guild-chat", ideas: [358], title: "Guild chat", economy: false,
    apply(cmd) {
      if (cmd.action !== "say") return fail("unknown action");
      const g = guildOf(e, cmd.company);
      if (!g) return fail("join a guild first");
      const text = cleanText(cmd.text, 200);
      if (!text) return fail("messages are 1-200 characters");
      if (!limit.take(cmd.company)) return fail("that's enough chat for today");
      const list = chats.get(g.id) ?? [];
      list.push({ tick: e.tick, from: cmd.company, text });
      if (list.length > CHAT_KEPT) list.shift();
      chats.set(g.id, list);
      return OK;
    },
    view(company) {
      const g = guildOf(e, company);
      return g ? (chats.get(g.id) ?? []).map(m => ({ tick: m.tick, from: name(e, m.from), text: m.text })) : [];
    },
  };
};

export const recruitmentModule: FeatureFactory = (e) => {
  const id = "social.recruitment";
  const posts = new Map<number, { pitch: string; tick: number }>();          // guild -> post
  const applications = new Map<number, Set<number>>();                       // guild -> companies
  return {
    id, ideas: [359], title: "Recruitment board", economy: false,
    apply(cmd) {
      const g = guildOf(e, cmd.company), rank = rankOf(e, cmd.company);
      switch (cmd.action) {
        case "post": {
          if (!g || !atLeast(rank, "officer")) return fail("only guild officers can post");
          const pitch = cleanText(cmd.pitch, 160, 10);
          if (!pitch) return fail("a pitch is 10-160 characters");
          posts.set(g.id, { pitch, tick: e.tick });
          return OK;
        }
        case "withdraw": if (!g || !atLeast(rank, "officer") || !posts.delete(g.id)) return fail("no post to withdraw"); return OK;
        case "apply": {
          if (g) return fail("you are already in a guild");
          const target = typeof cmd.guild === "number" ? social(e).guilds.get(cmd.guild) : undefined;
          if (!target || !posts.has(target.id)) return fail("that guild isn't recruiting");
          const set = applications.get(target.id) ?? new Set<number>();
          if (set.size >= 20) return fail("that guild has too many applications waiting");
          set.add(cmd.company); applications.set(target.id, set);
          return OK;
        }
        case "accept": case "decline": {
          if (!g || !atLeast(rank, "officer")) return fail("only officers handle applications");
          const set = applications.get(g.id);
          if (typeof cmd.target !== "number" || !set?.has(cmd.target)) return fail("no such application");
          set.delete(cmd.target);
          if (cmd.action === "accept" && !guildOf(e, cmd.target)) g.invites.add(cmd.target);   // they can now join
          return OK;
        }
        default: return fail("unknown action");
      }
    },
    advance() { for (const [gid, p] of posts) if (!social(e).guilds.has(gid) || e.tick - p.tick > 7 * 24) posts.delete(gid); },
    cards(company) {
      const g = guildOf(e, company);
      if (g && atLeast(rankOf(e, company), "officer")) {
        const apps = [...(applications.get(g.id) ?? [])].filter(c => e.companies.has(c) && !guildOf(e, c));
        return apps.length ? [{ title: "Applications", detail: apps.map(c => name(e, c)).join(", "),
          actions: apps.slice(0, 6).flatMap(c => [action(id, `Accept ${name(e, c)}`, "accept", { target: c }), action(id, `Decline ${name(e, c)}`, "decline", { target: c })]) }] : [];
      }
      if (g || !posts.size) return [];
      return [{ title: "Guilds recruiting", detail: [...posts].map(([gid, p]) => `${guildName(e, gid)}: ${p.pitch}`).join("\n"),
        actions: [...posts.keys()].slice(0, 6).map(gid => action(id, `Apply to ${social(e).guilds.get(gid)?.name}`, "apply", { guild: gid })) }];
    },
    world() { return [...posts].map(([gid, p]) => ({ guild: gid, name: guildName(e, gid), pitch: p.pitch })); },
  };
};
