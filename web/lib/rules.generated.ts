/**
 * AutoGrader · 内置核查规则（自动生成，请勿手改）
 * ============================================================================
 * 由 scripts/sync-assets.mjs 从
 *   backend/autograder-expert/agents/tools/rules/default.rules.json
 * 生成。源文件是规则的唯一真源（工具链 T2 与浏览器端规则引擎共用同一份）。
 *
 * 生成时间与来源摘要见 scripts/ 的同步日志；改规则请改源文件后重新同步。
 *
 * 规则集：autograder.default v1.0.0，共 13 条
 */

import type { RuleSet } from '@/lib/rules-engine';

export const DEFAULT_RULE_SET = {
  "ruleSetId": "autograder.default",
  "name": "计算机实验报告 · 默认规则集",
  "version": "1.0.0",
  "layer": "default",
  "readOnly": true,
  "note": "内置默认层，开箱可用。教师层按 ruleId 覆盖或追加；本文件本身不得被改写。规则条目只做事实陈述，不含评分逻辑。",
  "rules": [
    {
      "ruleId": "structure.chapter.principle",
      "enabled": true,
      "kind": "structure",
      "params": {
        "label": "实验原理",
        "patterns": [
          "实验原理",
          "原理"
        ]
      },
      "factTemplate": "章节「{label}」{present:存在|缺失}"
    },
    {
      "ruleId": "structure.chapter.environment",
      "enabled": true,
      "kind": "structure",
      "params": {
        "label": "实验环境",
        "patterns": [
          "实验环境",
          "环境",
          "开发环境"
        ]
      },
      "factTemplate": "章节「{label}」{present:存在|缺失}"
    },
    {
      "ruleId": "structure.chapter.steps",
      "enabled": true,
      "kind": "structure",
      "params": {
        "label": "实验步骤",
        "patterns": [
          "实验步骤",
          "步骤",
          "实现过程",
          "设计与实现"
        ]
      },
      "factTemplate": "章节「{label}」{present:存在|缺失}"
    },
    {
      "ruleId": "structure.chapter.results",
      "enabled": true,
      "kind": "structure",
      "params": {
        "label": "实验结果",
        "patterns": [
          "实验结果",
          "结果",
          "运行结果"
        ]
      },
      "factTemplate": "章节「{label}」{present:存在|缺失}"
    },
    {
      "ruleId": "structure.chapter.analysis",
      "enabled": true,
      "kind": "structure",
      "params": {
        "label": "结果分析",
        "patterns": [
          "结果分析",
          "分析",
          "讨论"
        ]
      },
      "factTemplate": "章节「{label}」{present:存在|缺失}"
    },
    {
      "ruleId": "structure.chapter.summary",
      "enabled": true,
      "kind": "structure",
      "params": {
        "label": "实验总结",
        "patterns": [
          "实验总结",
          "总结",
          "心得",
          "体会"
        ]
      },
      "factTemplate": "章节「{label}」{present:存在|缺失}"
    },
    {
      "ruleId": "code.blocks.present",
      "enabled": true,
      "kind": "code",
      "params": {
        "minCodeBlocks": 1
      },
      "factTemplate": "代码块数量 {actual}（要求至少 {minCodeBlocks}）"
    },
    {
      "ruleId": "code.api.required",
      "enabled": true,
      "kind": "code",
      "params": {
        "requiredApis": []
      },
      "factTemplate": "必需 API「{api}」{present:出现|未出现}"
    },
    {
      "ruleId": "statistics.char_count",
      "enabled": true,
      "kind": "statistics",
      "params": {
        "minChars": 800
      },
      "factTemplate": "正文字数 {actual}（要求至少 {minChars}）"
    },
    {
      "ruleId": "statistics.figure_count",
      "enabled": true,
      "kind": "statistics",
      "params": {
        "minFigures": 1
      },
      "factTemplate": "图表数量 {actual}（要求至少 {minFigures}）"
    },
    {
      "ruleId": "statistics.code_lines",
      "enabled": true,
      "kind": "statistics",
      "params": {
        "minCodeLines": 20
      },
      "factTemplate": "代码行数 {actual}（要求至少 {minCodeLines}）"
    },
    {
      "ruleId": "statistics.test_cases",
      "enabled": true,
      "kind": "statistics",
      "params": {
        "minTestCases": 0
      },
      "factTemplate": "测试用例数 {actual}（要求至少 {minTestCases}）"
    },
    {
      "ruleId": "similarity.shingle",
      "enabled": true,
      "kind": "similarity",
      "params": {
        "algorithm": "shingle",
        "shingleSize": 5
      },
      "factTemplate": "与语料最高相似度 {maxSimilarity}"
    }
  ]
} as unknown as RuleSet;

/** 内置规则集的条数（供界面显示"共 N 条规则"） */
export const DEFAULT_RULE_COUNT = 13;
