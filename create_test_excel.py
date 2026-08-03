import openpyxl
from openpyxl import Workbook

wb = Workbook()
ws = wb.active
ws.title = "参赛选手"

# Headers (Chinese, matching ParticipantImportService.js HEADER_MAP)
headers = ["省份", "城市", "区县", "学校", "姓名", "年龄", "组别", "队伍名称"]
ws.append(headers)

# 10 test participants with realistic data
participants = [
    ["北京市", "北京市", "海淀区", "清华大学附属中学", "张伟", 15, "高中组", "Alpha 队"],
    ["北京市", "北京市", "朝阳区", "北京八十中", "李娜", 16, "高中组", "Alpha 队"],
    ["上海市", "上海市", "浦东新区", "上海中学", "王强", 14, "高中组", "Alpha 队"],
    ["广东省", "广州市", "天河区", "华南师范大学附属中学", "刘芳", 15, "高中组", "Beta 队"],
    ["广东省", "深圳市", "南山区", "深圳中学", "陈明", 16, "高中组", "Beta 队"],
    ["浙江省", "杭州市", "西湖区", "杭州学军中学", "赵丽", 15, "高中组", "Beta 队"],
    ["江苏省", "南京市", "鼓楼区", "南京师范大学附属中学", "孙杰", 14, "高中组", "Gamma 队"],
    ["四川省", "成都市", "武侯区", "成都七中", "周雪", 16, "高中组", "Gamma 队"],
    ["湖北省", "武汉市", "武昌区", "华中师范大学第一附属中学", "吴涛", 15, "高中组", "Gamma 队"],
    ["山东省", "济南市", "历下区", "山东省实验中学", "郑琳", 14, "高中组", "Gamma 队"],
]

for p in participants:
    ws.append(p)

# Auto-adjust column widths
for col in ws.columns:
    max_length = 0
    column = col[0].column_letter
    for cell in col:
        try:
            if len(str(cell.value)) > max_length:
                max_length = len(str(cell.value))
        except:
            pass
    adjusted_width = min(max_length + 2, 50)
    ws.column_dimensions[column].width = adjusted_width

wb.save(r"C:\Users\Administrator\Desktop\project_3\test_participants.xlsx")
print("Created: test_participants.xlsx with 10 participants")
