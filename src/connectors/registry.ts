import type { IConnector } from "../types/index.js";
import { CryptoConnector } from "./crypto.js";
import { ForexConnector } from "./forex.js";
import { NewsConnector } from "./news.js";
import { TwitterConnector } from "./twitter.js";
import { BlockchainConnector } from "./blockchain.js";

class ConnectorRegistry {
  private connectors = new Map<string, IConnector>();

  constructor() {
    this.register(new CryptoConnector());
    this.register(new ForexConnector());
    this.register(new NewsConnector());
    this.register(new TwitterConnector());
    this.register(new BlockchainConnector());
  }

  register(connector: IConnector): void {
    this.connectors.set(connector.config.name, connector);
  }

  get(name: string): IConnector | undefined {
    return this.connectors.get(name);
  }

  list(): Array<{ name: string; description: string; cost: string }> {
    return Array.from(this.connectors.values()).map((c) => ({
      name: c.config.name,
      description: c.config.description,
      cost: c.config.cost,
    }));
  }

  toolDescriptions(): string {
    return Array.from(this.connectors.values())
      .map((c) => {
        const actions = this.getActionDescriptions(c.config.name);
        return `- **${c.config.name}**: ${c.config.description}. Actions: ${actions.join(", ")}. Cost: ${c.config.cost}.`;
      })
      .join("\n");
  }

  private getActionDescriptions(name: string): string[] {
    const actionMap: Record<string, string[]> = {
      crypto: ["getPrice(coins,currencies)", "getMarketData(coin)", "search(query)"],
      forex: ["getRates(base,targets)", "convert(from,to,amount)"],
      news: ["headlines(category)", "search(query)"],
      twitter: ["search(query)", "userTweets(userId)"],
      blockchain: ["getBalance(address)", "getTransactions(address)"],
    };
    return actionMap[name] || ["execute"];
  }
}

export const registry = new ConnectorRegistry();
