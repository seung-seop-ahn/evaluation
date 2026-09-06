# pass@k and pass^k

Two metrics for evaluating LLMs and agents when you run the same task multiple times.
They look similar, but they measure opposite things: pass@k measures **capability** ("can it succeed at least once?"), and pass^k measures **reliability** ("does it succeed every time?").

## pass@k — at least one success in k attempts

pass@k is the probability that **at least one** of k independent attempts is correct.

The idea comes from code generation. A coding agent can generate many candidate solutions in parallel, run a verifier (tests, a compiler, a judge) on each one, and give the user only the answer that passed. In this setup, the system succeeds if just one of the k candidates is correct, so pass@k is the right way to measure it.

The original Codex paper ("Evaluating Large Language Models Trained on Code", Chen et al. 2021) reported this on HumanEval:

- pass@1 = **28.8%** — with a single sample, the model solves 28.8% of the problems
- pass@100 = **70.2%** — if the model can try 100 samples per problem, at least one correct solution exists for 70.2% of the problems

So the same model looks more than twice as capable when you let it try many times and pick the best result.

> 한글 예시: 코딩 에이전트에게 같은 문제를 100번 병렬로 풀게 한 뒤, 테스트를 통과한 답 하나만 사용자에게 전달하는 구조. 한 번만 시도하면 28.8%밖에 못 풀지만, 100개 중 하나라도 맞으면 되는 구조에서는 70.2%의 문제를 해결할 수 있다. (참고: 75%가 아니라 70.2%가 논문의 정확한 수치)

## pass^k — all k attempts succeed

pass^k is the probability that **all** of k independent attempts are correct.

This metric was introduced by τ-bench (Sierra, 2024) for tool-using agents. If a single run succeeds with probability p, then pass^k is roughly p^k, so the score drops quickly as k grows. A model can have a decent pass@1 and still have a very low pass^k.

τ-bench showed this clearly: gpt-4o succeeded on fewer than 50% of retail customer-service tasks in one trial, and its pass^8 was **below 25%** — meaning that if the same task came in 8 times, the agent handled all 8 correctly less than a quarter of the time.

> 한글 예시: 같은 고객 문의가 하루에 8번 들어온다고 하자. pass^8이 25%라는 것은, 8명의 고객이 모두 올바른 응대를 받는 경우가 4일 중 하루뿐이라는 뜻이다. 한 번 잘 답하는 것과 매번 똑같이 잘 답하는 것은 완전히 다른 능력이다.
>
> 이 점수는 k가 커질수록 "보통" 내려가는 것이 아니라 수학적으로 반드시 내려간다. 단일 시도 성공률이 p라면 k번 모두 성공할 확률은 대략 p^k인데, p가 1보다 작은 이상 곱할수록 작아질 수밖에 없기 때문이다. 한 번에 90%를 성공하는 꽤 좋은 에이전트도 pass^1 = 90%, pass^8 ≈ 0.9^8 ≈ 43%, pass^100 ≈ 0.003%가 된다. "한 번은 잘하는" 수준과 "매번 잘하는" 수준의 격차는 k와 함께 기하급수적으로 벌어진다. 운영 환경에서 사용자가 겪는 것은 평균이 아니라 이 곱셈이다.

## Why the difference matters

For the same model, as k grows:

- pass@k goes **up** (more chances to get lucky)
- pass^k goes **down** (more chances to fail once)

Anthropic's engineering post "Demystifying evals for AI agents" makes this point with an example: at k=10, pass@k can approach 100% while pass^k falls toward zero.
A leaderboard score based on pass@k can hide the fact that the agent is unreliable in production.

> 한글 예시: 같은 모델에서 k를 키우면 pass@k는 단조 증가하고(한 번이라도 성공할 기회가 늘어남) pass^k는 단조 감소한다(한 번이라도 실패할 위험이 늘어남). 그래서 두 지표의 간격 자체가 신호가 된다. 간격이 크다는 것은 "능력은 있는데 일관성이 없다"는 뜻이다. pass@10이 100%에 가까운데 pass^10이 0에 가깝다면, 이 에이전트는 정답을 만들 줄은 알지만 언제 만들어줄지는 아무도 보장할 수 없는 상태다.

## When to use which

Use **pass@k** when:

- The system can generate many candidates and verify them before showing a result
- A wrong attempt is cheap and invisible to the user
- Typical fields: coding agents (test-verified generation), math and reasoning benchmarks, search over candidate solutions, best-of-n sampling with a reranker or judge

Use **pass^k** when:

- Every single run reaches a real user, and each failure has a cost
- Consistency is part of the product promise
- Typical fields: customer service agents, workflow automation, tool-using agents in production, any agent that must follow policies the same way every time

A practical rule: pass@k describes what the model **could** do with enough tries; pass^k describes what users will **actually experience** run after run. For production agents, track both, and treat pass^k as the harder, more honest bar.

## Repeated runs in LangSmith: num_repetitions

Both metrics need the same task to run k times. In LangSmith you do not write this loop yourself — `evaluate()` has a built-in option for it: `num_repetitions` in Python, `numRepetitions` in TypeScript.

```ts
await evaluate(target, {
    data: DATASET_NAME,
    evaluators: [judge],
    numRepetitions: 8, // every example runs 8 times in one experiment
});
```

Each example is executed k times inside a single experiment, and every run is scored by the evaluators. From those k scores per example you can read both metrics: if at least one run passed, the example counts toward pass@k; only if all runs passed does it count toward pass^k. This is also a cheap way to see how unstable an agent is — if the k repetitions of the same question return different scores, the variance itself is the finding.

> 한국어 설명: pass@k, pass^k처럼 같은 예제를 여러 번 실행하는 반복 작업은 직접 for 루프를 짜는 것이 아니라 `evaluate()`의 `num_repetitions`(TypeScript에서는 `numRepetitions`) 필드로 처리한다. 이 값을 8로 주면 하나의 Experiment 안에서 모든 예제가 8번씩 실행되고 각 실행이 개별 채점된다. 예제별 k개의 점수에서 "하나라도 성공"을 세면 pass@k, "전부 성공"을 세면 pass^k가 된다. 같은 질문의 반복 실행 점수가 서로 다르게 나온다면 그 편차 자체가 에이전트의 일관성 문제를 보여주는 발견이다.

## Sources

- Codex paper (pass@k, 28.8% → 70.2%): https://arxiv.org/abs/2107.03374
- τ-bench paper (pass^k, gpt-4o pass^8 < 25%): https://arxiv.org/abs/2406.12045
- Anthropic, "Demystifying evals for AI agents": https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
