from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('training', '0023_onsite_courses')]
    operations = [migrations.AddField(
        model_name='course', name='registration_key',
        field=models.CharField(max_length=64, null=True, blank=True, unique=True,
                               db_default=None, editable=False),
    )]
