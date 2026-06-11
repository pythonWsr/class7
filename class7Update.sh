#!/data/data/com.termux/files/usr/bin/bash
set -e

FORCE=false
MSG=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -f) FORCE=true; shift ;;
        -m)
            shift
            if [[ $# -gt 0 ]]; then
                MSG="$1"
                shift
            else
                echo "⚠️  -m 后未提供信息，将进入交互提示" >&2
            fi
            ;;
        -h|--help)
            echo "用法: $0 [-f] [-m \"提交信息\"]"
            echo "选项:"
            echo "  -f  强制模式，跳过远程差异检查"
            echo "  -m  提交信息"
            exit 0
            ;;
        *)
            echo "❌ 未知参数: $1"
            exit 1
            ;;
    esac
done

# 提交信息获取
if [[ -z "$MSG" ]]; then
    read -p "commit message: " MSG
    [[ -z "$MSG" ]] && MSG="a minor update"
fi

# 非强制模式：检查远程差异
if [[ "$FORCE" != true ]]; then
    echo "👉 获取远程最新状态..."
    git fetch origin

    BRANCH=$(git branch --show-current)
    if [[ -z "$BRANCH" ]]; then
        echo "❌ 无法检测当前分支"
        exit 1
    fi

    DIFF_FILES=$(git diff --name-only HEAD "origin/$BRANCH" 2>/dev/null || true)
    if [[ -n "$DIFF_FILES" ]]; then
        echo ""
        echo "⚠️  本地与远程 $BRANCH 存在差异的文件:"
        echo "$DIFF_FILES" | sed 's/^/  /'
        echo ""
        read -p "是否需要执行 git pull 以同步远程更新？ (y/n): " answer
        if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
            echo "👉 git pull"
            git pull
            echo "✅ 已同步远程更新。程序结束。"
        else
            echo "⚠️  跳过拉取，程序结束。请手动解决差异后再提交。"
        fi
        exit 0
    else
        echo "✅ 本地与远程无差异，继续推送流程..."
    fi
fi

# 正常推送
echo "👉 git add ."
git add .
echo "👉 git commit -m \"$MSG\""
git commit -m "$MSG"
echo "👉 git branch -M main"
git branch -M main
echo "👉 git push -u origin main -v"
git push -u origin main -v
echo "✅ 推送完成！"
