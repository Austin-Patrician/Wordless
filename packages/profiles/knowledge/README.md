# @wordless/profile-knowledge

知识库整理画像。

它是**唯一**能写知识库页面的画像:写工具与加工约定(`kb-processing` skill)成对出现,因为
"写是纪律" —— 没有约定的写入会让知识库碎片化(近重复的概念页、发散的标签),而那个损伤
累积且难回滚。其它画像只拿只读工具(`kb_query` / `kb_list_tags`)。

工具面里刻意**没有** `bash` / `write` / `edit`:bash 绕过应用层的路径守卫,所以"不给 bash"
才是"原始文件改不了"的真正保证;页面只能经 `kb_write_page`(守 schema、拒写 `raws/**`)。

见 `docs/architecture/knowledge-base.md` §6.2 与 §7.2。
